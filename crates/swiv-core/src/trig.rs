//! Integer trig matching the original `_sin256` / `_cos256` tables:
//! 512 steps per turn, amplitude 256.

pub const ANGLES: i32 = 512;
pub const ANGLE_MASK: i32 = ANGLES - 1;

fn table() -> &'static [i32; 512] {
    use std::sync::OnceLock;
    static T: OnceLock<[i32; 512]> = OnceLock::new();
    T.get_or_init(|| {
        let mut t = [0; 512];
        for (i, v) in t.iter_mut().enumerate() {
            *v = (256.0 * (i as f64 * std::f64::consts::TAU / 512.0).sin()).round() as i32;
        }
        t
    })
}

#[inline]
pub fn sin(a: i32) -> i32 {
    table()[(a & ANGLE_MASK) as usize]
}

#[inline]
pub fn cos(a: i32) -> i32 {
    table()[((a + 128) & ANGLE_MASK) as usize]
}

/// Angle (0..512) of the vector (dx, dz), using the same convention as sin/cos:
/// dx = sin(a), dz = cos(a).
pub fn atan2(dx: i32, dz: i32) -> i32 {
    let a = (dx as f64).atan2(dz as f64) * 512.0 / std::f64::consts::TAU;
    (a.round() as i32) & ANGLE_MASK
}

/// Signed smallest difference b - a in (-256, 256].
#[inline]
pub fn delta(a: i32, b: i32) -> i32 {
    let d = (b - a) & ANGLE_MASK;
    if d > 256 {
        d - 512
    } else {
        d
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_original_table_points() {
        // Values read from swiv_win.exe: _sin256[0,64,128,256,384] = 0,181,256,0,-256
        assert_eq!([sin(0), sin(64), sin(128), sin(256), sin(384)], [0, 181, 256, 0, -256]);
        assert_eq!([cos(0), cos(128), cos(256)], [256, 0, -256]);
        assert_eq!(atan2(0, 100), 0);
        assert_eq!(atan2(100, 0), 128);
        assert_eq!(delta(500, 10), 22);
    }
}
