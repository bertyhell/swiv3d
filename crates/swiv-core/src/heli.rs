//! Player helicopter: a line-by-line port of `CONTROL_keyboard_1H` + `OBFUNC_heli_base`
//! (via `OBJECT_Heli1`, hover height 0x50) from swiv_win.exe. All arithmetic is the
//! original 32-bit integer maths, including its arithmetic shifts.

use crate::trig::{cos, sin};
use crate::world::Terrain;

/// Hover height passed to `OBFUNC_heli_base` by `OBJECT_Heli1` (in units of 256).
pub const HOVER: i32 = 0x50;
/// Clearance below which the craft hits the ground (`y - 0x7d0 <= ground`).
pub const CRASH_CLEARANCE: i32 = 0x7d0;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Input {
    pub left: bool,
    pub right: bool,
    pub forward: bool,
    pub back: bool,
    pub strafe_left: bool,
    pub strafe_right: bool,
    /// Held: left/right strafe instead of turning (key slot +0xdc).
    pub strafe_mod: bool,
    pub fire: bool,
    pub special: bool,
    pub next_weapon: bool,
    pub prev_weapon: bool,
}

/// Yaw accumulator step per tick while turning (<<8, 512 yaw units per full turn).
const TURN_RATE: i32 = 0x2a0;

#[derive(Debug, Clone, PartialEq)]
pub struct Heli {
    /// +0x1c/+0x20/+0x24
    pub pos: [i32; 3],
    /// +0x28/+0x2c/+0x30
    pub vel: [i32; 3],
    /// +0x34, 512 per turn
    pub yaw: i32,
    /// +0x38 (negative = forward)
    pub thrust: i32,
    /// +0x3c (positive = right)
    pub strafe: i32,
    /// `_tvars`: yaw accumulator (<<8), thrust and strafe filters.
    pub tvars: [i32; 3],
    pub crashed: bool,
}

impl Heli {
    pub fn new(pos: [i32; 3], yaw: i32) -> Self {
        Heli { pos, vel: [0; 3], yaw, thrust: 0, strafe: 0, tvars: [yaw << 8, 0, 0], crashed: false }
    }

    /// `CONTROL_keyboard_1H` (keyboard path; the joystick path scales the axes instead).
    pub fn control(&mut self, inp: &Input, max_height: i32) {
        let mut c = [0i32; 3];
        if inp.forward {
            c[1] += 0x4b0;
        }
        if inp.back {
            c[1] -= 0x4b0;
        }
        if inp.strafe_mod {
            if inp.left {
                c[2] -= 0x320;
            }
            if inp.right {
                c[2] += 0x320;
            }
        } else {
            if inp.strafe_left {
                c[2] -= 0x320;
            }
            if inp.strafe_right {
                c[2] += 0x320;
            }
            // The original turns at 0x258; slightly faster so the player can follow the
            // enemy aircraft.
            if inp.left {
                c[0] -= TURN_RATE;
                c[2] -= 0xc8;
            }
            if inp.right {
                c[0] += TURN_RATE;
                c[2] += 0xc8;
            }
        }
        let t0 = self.tvars[0] + c[0];
        let t1 = self.tvars[1] - c[1];
        let t2 = self.tvars[2] + c[2];
        self.yaw = t0 >> 8;
        self.thrust = t1 >> 8;
        self.strafe = t2 >> 7;
        self.tvars = [t0, (t1 * 14) >> 4, (t2 * 14) >> 4];
        if self.pos[1] > max_height {
            self.pos[1] = max_height;
        }
    }

    /// Generic object step (`LSCAPE_gamelp`: pos += vel) followed by `OBFUNC_heli_base`.
    /// Returns true on a ground impact this tick.
    pub fn step(&mut self, t: &Terrain) -> bool {
        for k in 0..3 {
            self.pos[k] += self.vel[k];
        }
        if self.strafe < 0 {
            self.strafe += 4;
        }
        if self.strafe > 0 {
            self.strafe -= 4;
        }
        if self.thrust < 0 {
            self.thrust += 2;
        }
        if self.thrust > 0 {
            self.thrust -= 2;
        }
        let a = self.yaw & 0x1ff;
        if self.thrust != 0 {
            self.vel[0] -= (sin(a) * self.thrust) >> 5;
            self.vel[2] -= (cos(a) * self.thrust) >> 5;
        }
        if self.strafe != 0 {
            let b = (self.yaw + 0x80) & 0x1ff;
            self.vel[0] += (sin(b) * self.strafe) >> 6;
            self.vel[2] += (cos(b) * self.strafe) >> 6;
        }
        let here = t.height(self.pos[0], self.pos[2]);
        let ahead = t.height(self.pos[0] + (self.vel[0] << 5), self.pos[2] + (self.vel[2] << 5));
        let g = here.max(ahead);
        let err = (g >> 8) + HOVER - (self.pos[1] >> 8);
        if err > 0 {
            self.vel[1] += err * 2;
        }
        if err < 0 {
            self.vel[1] += err >> 1;
        }
        for v in &mut self.vel {
            let d = *v >> 4;
            *v -= if d == 0 { *v } else { d };
        }
        if self.pos[1] - CRASH_CLEARANCE <= here {
            // Bounce away towards the lowest of 16 surrounding probes, as the original does.
            let mut best = (i32::MAX, 0);
            for i in 0..16 {
                let a = i * 32;
                let h = t.height(self.pos[0] + sin(a), self.pos[2] + cos(a));
                if h < best.0 {
                    best = (h, a);
                }
            }
            self.vel = [sin(best.1) << 4, 0x3e8, cos(best.1) << 4];
            self.crashed = true;
            return true;
        }
        false
    }

    /// Visual attitude (pitch, roll) in angle units, derived from the control filters.
    pub fn attitude(&self) -> (i32, i32) {
        (self.thrust.clamp(-40, 40) / 2, self.strafe.clamp(-60, 60) / 3)
    }
}
