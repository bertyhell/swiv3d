//! Browser front-end. JavaScript owns the page (file loading, HUD, audio); this crate owns
//! the simulation loop and WebGL 2 rendering.

mod render;

use render::{Camera, Renderer, TEXT_FLIGHT_SECS};
use swiv_core::trig;
use swiv_core::world::{wrap, Brain, Event, Instance, Phase, World, TICK_HZ};
use swiv_core::Input;
use swiv_formats::bundle::Bundle;
use swiv_formats::level::Level;
use swiv_formats::strings::StringTable;
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext as GL};

/// Input bits shared with `web/main.js`.
pub mod keys {
    pub const LEFT: u32 = 1;
    pub const RIGHT: u32 = 2;
    pub const FORWARD: u32 = 4;
    pub const BACK: u32 = 8;
    pub const STRAFE_LEFT: u32 = 16;
    pub const STRAFE_RIGHT: u32 = 32;
    pub const STRAFE_MOD: u32 = 64;
    pub const FIRE: u32 = 128;
    pub const SPECIAL: u32 = 256;
    pub const NEXT_WEAPON: u32 = 512;
    pub const PREV_WEAPON: u32 = 1024;
}

fn input_from(bits: u32) -> Input {
    use keys::*;
    Input {
        left: bits & LEFT != 0,
        right: bits & RIGHT != 0,
        forward: bits & FORWARD != 0,
        back: bits & BACK != 0,
        strafe_left: bits & STRAFE_LEFT != 0,
        strafe_right: bits & STRAFE_RIGHT != 0,
        strafe_mod: bits & STRAFE_MOD != 0,
        fire: bits & FIRE != 0,
        special: bits & SPECIAL != 0,
        next_weapon: bits & NEXT_WEAPON != 0,
        prev_weapon: bits & PREV_WEAPON != 0,
    }
}

/// Event codes shared with `web/main.js`.
fn event_code(e: &Event) -> u32 {
    match e {
        Event::PlayerShot => 1,
        Event::EnemyShot => 2,
        Event::Explosion { big: false } => 3,
        Event::Explosion { big: true } => 4,
        Event::Hit => 5,
        Event::PickupStart => 11,
        Event::Pickup(code) => 1000 + (*code).clamp(0, 999) as u32,
        Event::PlayerHit => 7,
        Event::PlayerDied => 8,
        Event::ObjectiveDone(g) => 100 + *g as u32,
        Event::LevelComplete => 9,
        Event::GameOver => 10,
    }
}

#[wasm_bindgen]
pub struct Game {
    canvas: HtmlCanvasElement,
    renderer: Renderer,
    level: Option<Level>,
    world: Option<World>,
    accum: f64,
    time: f64,
    prev_pos: [i32; 3],
    prev_yaw: i32,
    cam_yaw: f32,
    events: Vec<u32>,
    instances: Vec<Instance>,
    fog_far: f32,
    /// Pickup names in flight, with the time they appeared.
    texts: Vec<(String, f64)>,
    /// Menu backdrop: the craft flies itself over the level, untouchable, and its events are
    /// dropped (the original's menus run over a live flyover of a level).
    attract: bool,
    /// Menu heading in the 3D font: text, colour and the time it appeared.
    title: Option<(String, [f32; 3], f64)>,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas: HtmlCanvasElement) -> Result<Game, JsValue> {
        // Opaque: translucent draws (shadows, rotors, the lock-on ring) must not leave the
        // canvas alpha below 1, or the page composites it with invalid premultiplied colour.
        let opts = js_sys::Object::new();
        js_sys::Reflect::set(&opts, &"alpha".into(), &false.into())?;
        let gl: GL = canvas.get_context_with_context_options("webgl2", &opts)?.ok_or("WebGL 2 is not available")?.dyn_into()?;
        Ok(Game {
            canvas,
            renderer: Renderer::new(gl)?,
            level: None,
            world: None,
            accum: 0.0,
            time: 0.0,
            prev_pos: [0; 3],
            prev_yaw: 0,
            cam_yaw: 0.0,
            events: Vec::new(),
            instances: Vec::new(),
            fog_far: 3600.0,
            texts: Vec::new(),
            attract: false,
            title: None,
        })
    }

    /// Load the 3D font (`GLOBAL.BD` resource 200) used for pickup names.
    pub fn load_font(&mut self, global_bd: Vec<u8>) -> Result<(), JsValue> {
        let err = |e: swiv_formats::Error| JsValue::from_str(&e.to_string());
        let b = Bundle::parse(global_bd).map_err(err)?;
        let font = swiv_formats::font3d::Font3d::parse(b.require(swiv_formats::font3d::RES_3DFONT).map_err(err)?).map_err(err)?;
        self.renderer.load_font(&font)
    }

    /// Fly a pickup name across the screen in the 3D font.
    pub fn fly_text(&mut self, text: String) {
        self.texts.push((text, self.time));
    }

    /// Parse and start a level from the raw `.SLV` bytes.
    pub fn load_level(&mut self, slv: Vec<u8>) -> Result<(), JsValue> {
        let level = Level::parse(slv).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.start_level(level)
    }

    /// Start a level from the `swiv-pack` web layout: the slim `level.bd`, the height, type and
    /// colour map PNGs, and the texture page PNGs (`texture_ids[i]` is `textures[i]`'s page).
    pub fn load_level_parts(
        &mut self,
        level_bd: Vec<u8>,
        height_png: Vec<u8>,
        type_png: Vec<u8>,
        colour_png: Vec<u8>,
        texture_ids: Vec<u32>,
        textures: js_sys::Array,
    ) -> Result<(), JsValue> {
        let err = |e: swiv_formats::Error| JsValue::from_str(&e.to_string());
        let png = |b: &[u8]| swiv_formats::pack::decode_png(b).map(|d| d.2).map_err(err);
        let texels = texture_ids
            .iter()
            .zip(textures.iter())
            .map(|(&id, t)| Ok((id, png(&js_sys::Uint8Array::new(&t).to_vec())?)))
            .collect::<Result<Vec<_>, JsValue>>()?;
        let bundle = Bundle::parse(level_bd).map_err(err)?;
        let level = Level::from_parts(bundle, png(&height_png)?, png(&type_png)?, png(&colour_png)?, texels).map_err(err)?;
        self.start_level(level)
    }

    fn start_level(&mut self, level: Level) -> Result<(), JsValue> {
        self.renderer.load_level(&level)?;
        let world = World::new(&level);
        self.prev_pos = world.player.pos;
        self.prev_yaw = world.player.yaw;
        self.cam_yaw = world.player.yaw as f32;
        self.world = Some(world);
        self.level = Some(level);
        self.accum = 0.0;
        Ok(())
    }

    /// Keep lives/score/weapons when moving to the next level (`ammo` from [`Game::ammo`]).
    pub fn carry_over(&mut self, score: i32, lives: i32, weapon_level: i32, ammo: Vec<i32>, special: i32) {
        if let Some(w) = &mut self.world {
            w.score = score;
            w.lives = lives;
            w.weapon_level = weapon_level;
            for (a, &b) in w.ammo.iter_mut().zip(&ammo) {
                *a = b;
            }
            w.special = usize::try_from(special).ok().filter(|&k| w.ammo.get(k).is_some_and(|&a| a > 0));
        }
    }

    /// Special weapon ammo per kind (index = GLOBAL.BD strings group 100).
    pub fn ammo(&self) -> Vec<i32> {
        self.world.as_ref().map_or(vec![], |w| w.ammo.to_vec())
    }

    pub fn restart_level(&mut self) {
        if let Some(l) = &self.level {
            self.world = Some(World::new(l));
        }
    }

    /// Run the loaded level as a menu backdrop (see `attract`).
    pub fn set_attract(&mut self, on: bool) {
        self.attract = on;
        self.events.clear();
    }

    /// Show a menu heading in the 3D font (lines split by `\n`); an empty text hides it.
    pub fn set_title(&mut self, text: String, r: f32, g: f32, b: f32) {
        let same = self.title.as_ref().is_some_and(|t| t.0 == text && t.1 == [r, g, b]);
        if text.is_empty() {
            self.title = None;
        } else if !same {
            self.title = Some((text, [r, g, b], self.time));
        }
    }

    pub fn set_view_distance(&mut self, cells: f32) {
        self.fog_far = cells * 64.0;
    }

    /// Advance the simulation by real time (ms) at a fixed TICK_HZ.
    pub fn update(&mut self, dt_ms: f64, key_bits: u32) {
        let Some(w) = &mut self.world else { return };
        let input = if self.attract {
            // Autopilot: cruise ahead, with a slow turn now and then.
            let t = w.tick;
            Input { forward: t % 300 < 260, left: t % 420 < 50, right: (t + 210) % 420 < 30, ..Default::default() }
        } else {
            input_from(key_bits)
        };
        // Targets reach halfway to the black fog at the horizon.
        w.target_range = (self.fog_far / 64.0 / 2.0) as i32;
        let tick = 1000.0 / TICK_HZ as f64;
        self.accum = (self.accum + dt_ms.min(250.0)).min(tick * 8.0);
        self.time += dt_ms / 1000.0;
        while self.accum >= tick {
            self.accum -= tick;
            self.prev_pos = w.player.pos;
            self.prev_yaw = w.player.yaw;
            if self.attract {
                w.health = 100;
                w.lives = w.lives.max(3);
            }
            w.step(&input);
            if !self.attract {
                self.events.extend(w.events.iter().map(event_code));
            }
        }
    }

    pub fn render(&mut self) {
        let (cw, ch) = (self.canvas.client_width().max(1) as u32, self.canvas.client_height().max(1) as u32);
        let dpr = web_sys::window().map(|w| w.device_pixel_ratio()).unwrap_or(1.0).min(2.0);
        let (pw, ph) = ((cw as f64 * dpr) as u32, (ch as f64 * dpr) as u32);
        if self.canvas.width() != pw || self.canvas.height() != ph {
            self.canvas.set_width(pw);
            self.canvas.set_height(ph);
        }
        let Some(w) = &self.world else { return };
        let alpha = (self.accum / (1000.0 / TICK_HZ as f64)) as f32;
        let lerp = |a: i32, b: i32| a + (wrap(b - a) as f32 * alpha) as i32;
        let p = [
            lerp(self.prev_pos[0], w.player.pos[0]),
            lerp(self.prev_pos[1], w.player.pos[1]),
            lerp(self.prev_pos[2], w.player.pos[2]),
        ];
        let yaw = self.prev_yaw as f32 + trig::delta(self.prev_yaw, w.player.yaw) as f32 * alpha;
        // Chase camera: trails the craft's heading with damping, high above and behind,
        // looking down at ~30 degrees so the craft sits just below the middle of the screen
        // (matched against footage of the original).
        let d = trig::delta(self.cam_yaw.round() as i32, yaw.round() as i32) as f32;
        self.cam_yaw += d * 0.08;
        let a = self.cam_yaw * std::f32::consts::TAU / 512.0;
        let back = 235.0 * 256.0;
        let mut cam_pos = [p[0] - (a.sin() * back) as i32, p[1] + 195 * 256, p[2] - (a.cos() * back) as i32];
        let ground = w.terrain.height(cam_pos[0], cam_pos[2]) + 30 * 256;
        cam_pos[1] = cam_pos[1].max(ground);
        let cam = Camera { pos: cam_pos, yaw: self.cam_yaw, pitch: 0.55, fov: 1.05 };
        w.instances(&mut self.instances);
        let beams = w.beams();
        if w.phase == Phase::Playing {
            if let Some(pl) = self.instances.iter_mut().find(|i| i.model == swiv_core::world::PLAYER_MODEL) {
                pl.pos = p;
                pl.yaw = yaw.round() as i32;
            }
            // The shield rides with the craft: draw it at the same interpolated position,
            // or it lags a tick behind and jitters while moving.
            for s in self.instances.iter_mut().filter(|i| i.model == swiv_core::world::SHIELD_MODEL) {
                s.pos = p;
            }
        }
        let now = self.time;
        self.texts.retain(|(_, t0)| now - t0 < TEXT_FLIGHT_SECS as f64);
        let texts: Vec<(String, f32)> = self.texts.iter().map(|(s, t0)| (s.clone(), ((now - t0) as f32 / TEXT_FLIGHT_SECS).clamp(0.0, 1.0))).collect();
        let title = self.title.as_ref().map(|(t, c, t0)| (t.as_str(), *c, (now - t0) as f32));
        self.renderer.render(pw as i32, ph as i32, &cam, &self.instances, &beams, &texts, title, self.time as f32, self.fog_far);
    }

    /// A still of the level around map cell `(x, z)` for the mission briefing's close-ups,
    /// drawn into the canvas at `w` x `h` pixels: the ground there seen from above and behind,
    /// facing the craft's start heading, like the original's pre-rendered briefing shots.
    /// `range` scales the camera's distance (1 frames a base; the start uses less, to show the craft).
    /// The caller copies the canvas out (drawImage) before yielding to the browser.
    pub fn snapshot(&mut self, x: f32, z: f32, w: u32, h: u32, range: f32) {
        let Some(world) = &self.world else { return };
        let (w, h) = (w.max(1), h.max(1));
        if self.canvas.width() != w || self.canvas.height() != h {
            self.canvas.set_width(w);
            self.canvas.set_height(h);
        }
        let target = [(x * 16384.0) as i32, 0, (z * 16384.0) as i32];
        let ground = world.terrain.height(target[0], target[2]);
        let yaw = world.player.yaw as f32;
        let a = yaw * std::f32::consts::TAU / 512.0;
        let (back, up) = (560.0 * 256.0 * range, 330.0 * 256.0 * range);
        let mut cam_pos = [target[0] - (a.sin() * back) as i32, ground + up as i32, target[2] - (a.cos() * back) as i32];
        // Rise until the view of the place clears the ground in between.
        for k in 0..=12 {
            let f = k as f32 / 12.0;
            let (px, pz) = (cam_pos[0] + ((target[0] - cam_pos[0]) as f32 * f) as i32, cam_pos[2] + ((target[2] - cam_pos[2]) as f32 * f) as i32);
            let clear = world.terrain.height(px, pz) + 24 * 256;
            if f < 1.0 {
                // The sight line at f is ground + (cam - ground) * (1 - f); it must pass `clear`.
                let need = ground + ((clear - ground) as f32 / (1.0 - f)) as i32;
                cam_pos[1] = cam_pos[1].max(need.min(ground + (up * 3.0) as i32));
            }
        }
        let pitch = ((cam_pos[1] - ground) as f32).atan2(back);
        let cam = Camera { pos: cam_pos, yaw, pitch, fov: 0.95 };
        world.instances(&mut self.instances);
        self.renderer.render(w as i32, h as i32, &cam, &self.instances, &[], &[], None, self.time as f32, self.fog_far);
    }

    /// Event codes produced since the last call.
    pub fn take_events(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.events)
    }

    /// [score, lives, health, special kind (-1 none), its ammo, weapon_level, objective (-1 none),
    ///  objectives_left, objectives_total, phase (0 play, 1 dead, 2 complete, 3 over), speed,
    ///  target(0/1)]
    pub fn hud(&self) -> Vec<i32> {
        let Some(w) = &self.world else { return vec![] };
        let obj = w.current_objective().map_or(-1, |g| g as i32);
        let (left, total) = match w.current_objective() {
            Some(g) => (w.objectives_left[g as usize] as i32, w.objectives_total[g as usize] as i32),
            None => (0, 0),
        };
        let v = w.player.vel;
        vec![
            w.score,
            w.lives,
            w.health.max(0),
            w.special.map_or(-1, |k| k as i32),
            w.special.map_or(0, |k| w.ammo[k]),
            w.weapon_level,
            obj,
            left,
            total,
            match w.phase {
                Phase::Playing => 0,
                Phase::Dead => 1,
                Phase::Complete => 2,
                Phase::GameOver => 3,
            },
            ((v[0] as f64).hypot(v[2] as f64)) as i32,
            w.target.is_some() as i32,
        ]
    }

    /// Radar blips relative to the player, rotated so +y is the heading:
    /// [dx, dy, kind] triplets in cells (kind 0 enemy, 1 objective, 2 pickup).
    pub fn radar(&self, range_cells: f32) -> Vec<f32> {
        let Some(w) = &self.world else { return vec![] };
        let p = w.player.pos;
        let a = w.player.yaw as f32 * std::f32::consts::TAU / 512.0;
        let (s, c) = a.sin_cos();
        let mut out = Vec::new();
        let cur = w.current_objective();
        for e in w.entities.iter().filter(|e| e.alive) {
            let kind = if e.objective.is_some() && e.objective == cur {
                1.0
            } else if e.brain == Brain::Pickup {
                2.0
            } else if e.hostile {
                0.0
            } else {
                continue;
            };
            let dx = wrap(e.pos[0] - p[0]) as f32 / 16384.0;
            let dz = wrap(e.pos[2] - p[2]) as f32 / 16384.0;
            if dx.abs() > range_cells || dz.abs() > range_cells {
                continue;
            }
            out.extend_from_slice(&[dx * c - dz * s, dx * s + dz * c, kind]);
        }
        out
    }

    /// Player position in map cells and heading in radians, for the minimap, followed by the
    /// nearest remaining target of the current objective in map cells (-1, -1 when none).
    pub fn player_map(&self) -> Vec<f32> {
        let Some(w) = &self.world else { return vec![] };
        let p = w.player.pos;
        let cur = w.current_objective();
        let goal = w
            .entities
            .iter()
            .filter(|e| e.alive && e.objective.is_some() && e.objective == cur)
            .min_by_key(|e| {
                let (dx, dz) = (wrap(e.pos[0] - p[0]) as i64, wrap(e.pos[2] - p[2]) as i64);
                dx * dx + dz * dz
            })
            .map_or([-1.0, -1.0], |e| [e.pos[0] as f32 / 16384.0, e.pos[2] as f32 / 16384.0]);
        vec![
            p[0] as f32 / 16384.0,
            p[2] as f32 / 16384.0,
            w.player.yaw as f32 * std::f32::consts::TAU / 512.0,
            goal[0],
            goal[1],
        ]
    }

    /// For the mission briefing: the craft's start, then every objective target, as
    /// [x, z, group] triplets in map cells (group -1 for the start).
    pub fn briefing(&self) -> Vec<f32> {
        let Some(w) = &self.world else { return vec![] };
        let p = w.player.pos;
        let mut out = vec![p[0] as f32 / 16384.0, p[2] as f32 / 16384.0, -1.0];
        for e in w.entities.iter().filter(|e| e.alive) {
            if let Some(g) = e.objective {
                out.extend_from_slice(&[e.pos[0] as f32 / 16384.0, e.pos[2] as f32 / 16384.0, g as f32]);
            }
        }
        out
    }

    /// 512x512 RGBA of the level's colour map.
    pub fn colour_map(&self) -> Vec<u8> {
        let Some(l) = &self.level else { return vec![] };
        l.mmap.iter().flat_map(|&i| {
            let c = l.palette[i as usize];
            [c[0], c[1], c[2], 255]
        }).collect()
    }
}

/// Sound effects inside SOUNDS.BD as [effect id, byte offset, byte length] triples.
#[wasm_bindgen]
pub fn sound_offsets(data: &[u8]) -> Vec<u32> {
    swiv_formats::sounds::split(data).iter().flat_map(|s| [s.effect, s.offset as u32, s.riff.len() as u32]).collect()
}

/// UI strings from GLOBAL.BD as "lang|group|index|text" lines.
#[wasm_bindgen]
pub fn global_strings(data: Vec<u8>) -> Result<String, JsValue> {
    let b = Bundle::parse(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let t = StringTable::parse(b.require(100).map_err(|e| JsValue::from_str(&e.to_string()))?)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(t.map.iter().map(|((l, g, i), s)| format!("{l}|{g}|{i}|{s}\n")).collect())
}

#[wasm_bindgen(start)]
pub fn start() {
    web_sys::console::log_1(&"swiv-web loaded".into());
}
