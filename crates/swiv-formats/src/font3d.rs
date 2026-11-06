//! `_GLOBAL_3dfont` (`GLOBAL.BD` resource 200): extruded polygon letters, used for the
//! pickup names that fly across the screen. `GLOBAL_relocate_3dfont` patches the offsets
//! below into pointers on load.
//!
//! ```text
//! 256 x 28-byte records, indexed by character code:
//!     i32 half_width      glyph spans -half_width..half_width; also the pen advance per side
//!     i32 vertex_offset   relative to the resource start
//!     i32 vertex_count
//!     i32 face_offset
//!     i32 face_count
//!     i32 0x7000, i32 23  (same in every record)
//! vertices: {i32 x, i32 y, i32 z}        y up, about -91..108 tall, z -38..38 deep
//! faces:    {i32 v0, i32 v1, i32 v2, i32 side}
//! ```
//! Characters without a shape (space) have a vertex count of 0 or -1 and keep the width.

use crate::{i32_at, Result};

pub const RES_3DFONT: u32 = 200;

#[derive(Debug, Clone, Default)]
pub struct Glyph {
    pub half_width: i32,
    pub vertices: Vec<[i32; 3]>,
    pub faces: Vec<[u32; 3]>,
}

#[derive(Debug, Clone)]
pub struct Font3d {
    pub glyphs: Vec<Glyph>,
}

impl Font3d {
    pub fn parse(b: &[u8]) -> Result<Font3d> {
        let mut glyphs = Vec::with_capacity(256);
        for c in 0..256 {
            let r = c * 28;
            let half_width = i32_at(b, r, "3d font record")?;
            let (vo, vc) = (i32_at(b, r + 4, "3d font record")?, i32_at(b, r + 8, "3d font record")?);
            let (fo, fc) = (i32_at(b, r + 12, "3d font record")?, i32_at(b, r + 16, "3d font record")?);
            let mut g = Glyph { half_width, ..Default::default() };
            if vc > 0 && fc > 0 && vo > 0 && fo > 0 {
                for k in 0..vc as usize {
                    let o = vo as usize + k * 12;
                    g.vertices.push([i32_at(b, o, "3d font vertex")?, i32_at(b, o + 4, "3d font vertex")?, i32_at(b, o + 8, "3d font vertex")?]);
                }
                for k in 0..fc as usize {
                    let o = fo as usize + k * 16;
                    let f = [i32_at(b, o, "3d font face")?, i32_at(b, o + 4, "3d font face")?, i32_at(b, o + 8, "3d font face")?];
                    if f.iter().all(|&i| i >= 0 && i < vc) {
                        g.faces.push(f.map(|i| i as u32));
                    }
                }
            }
            glyphs.push(g);
        }
        Ok(Font3d { glyphs })
    }

    pub fn glyph(&self, c: char) -> Option<&Glyph> {
        self.glyphs.get(c as usize)
    }
}
