//! 3D models: level resources 10000..=10999 (`raw_models[id % 1000]` in the original).
//!
//! ```text
//! +0x00 i32 vertex_count
//! +0x04 i32 face_count
//! +0x08 i32 normal_count
//! +0x0C i32 h3            (grows with size; probably a collision/bounding value)
//! +0x10 i32 y_min         (lowest y; used to sit the model on the ground)
//! +0x14 i32 h5            (30 for player craft/weapons, 40 scenery, 100 foliage)
//! +0x18 u32 face_offset   (relative to model start; patched into a pointer on load)
//! +0x1C u32 normal_offset
//! +0x20 vertices: vertex_count * {i32 x, i32 y, i32 z, i32 part}   (y up)
//! faces: face_count * 42 bytes
//!     u32 v[3]; u32 n[3]; u32 tex; i16 u[3]; i16 v[3]; u16 flags
//! normals: normal_count * {i32 x, i32 y, i32 z}  (scaled by 100)
//! ```
//! `tex / 16` selects the texture page (resource 12000 + page) and `tex % 16` a 64x64 tile;
//! u/v are texel offsets inside that tile; v counts upwards from the tile's bottom row
//! (0 = row 63, -63 = row 0).

use crate::{i16_at, i32_at, u16_at, u32_at, Result};

pub const FACE_SIZE: usize = 42;

/// Face flag bits observed in the data.
pub mod flags {
    /// Special geometry (rotor discs etc.); its tex/uv fields hold other data.
    pub const SPECIAL_1: u16 = 0x0001;
    pub const SPECIAL_2: u16 = 0x0002;
    /// Palette index 0 is see-through (foliage, fences, sprites).
    pub const TRANSPARENT: u16 = 0x0004;
    /// Combined with TRANSPARENT on flat billboard sprites (trees).
    pub const SPRITE: u16 = 0x0001;
    /// Flat ground-shadow polygon at the model's base; tex/uv do not reference a texture.
    pub const SHADOW: u16 = 0x0028;
    pub const DOUBLE: u16 = 0x0200;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vertex {
    pub pos: [i32; 3],
    pub part: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Face {
    pub v: [u32; 3],
    pub n: [u32; 3],
    pub tex: u32,
    pub uv: [[i16; 2]; 3],
    pub flags: u16,
}

impl Face {
    pub fn is_special(&self) -> bool {
        self.flags & (flags::SPECIAL_1 | flags::SPECIAL_2) != 0 && self.flags & flags::TRANSPARENT == 0
    }
    pub fn is_sprite(&self) -> bool {
        self.flags == 5
    }
    pub fn page(&self) -> u32 {
        self.tex / 16
    }
    pub fn tile(&self) -> u32 {
        self.tex % 16
    }
}

#[derive(Debug, Clone)]
pub struct Model {
    pub id: u32,
    pub h3: i32,
    pub y_min: i32,
    pub h5: i32,
    pub vertices: Vec<Vertex>,
    pub faces: Vec<Face>,
    pub normals: Vec<[i32; 3]>,
}

impl Model {
    pub fn parse(id: u32, b: &[u8]) -> Result<Model> {
        let nv = i32_at(b, 0, "model header")?.max(0) as usize;
        let nf = i32_at(b, 4, "model header")?.max(0) as usize;
        let nn = i32_at(b, 8, "model header")?.max(0) as usize;
        let fo = u32_at(b, 0x18, "model header")? as usize;
        let no = u32_at(b, 0x1c, "model header")? as usize;
        let mut vertices = Vec::with_capacity(nv);
        for k in 0..nv {
            let o = 0x20 + k * 16;
            vertices.push(Vertex {
                pos: [i32_at(b, o, "vertex")?, i32_at(b, o + 4, "vertex")?, i32_at(b, o + 8, "vertex")?],
                part: i32_at(b, o + 12, "vertex")?,
            });
        }
        let mut faces = Vec::with_capacity(nf);
        for k in 0..nf {
            let o = fo + k * FACE_SIZE;
            let mut f = Face { v: [0; 3], n: [0; 3], tex: 0, uv: [[0; 2]; 3], flags: 0 };
            for j in 0..3 {
                f.v[j] = u32_at(b, o + j * 4, "face")?;
                f.n[j] = u32_at(b, o + 12 + j * 4, "face")?;
                f.uv[j] = [i16_at(b, o + 28 + j * 2, "face")?, i16_at(b, o + 34 + j * 2, "face")?];
            }
            f.tex = u32_at(b, o + 24, "face")?;
            f.flags = u16_at(b, o + 40, "face")?;
            faces.push(f);
        }
        let mut normals = Vec::with_capacity(nn);
        for k in 0..nn {
            let o = no + k * 12;
            normals.push([i32_at(b, o, "normal")?, i32_at(b, o + 4, "normal")?, i32_at(b, o + 8, "normal")?]);
        }
        Ok(Model {
            id,
            h3: i32_at(b, 0x0c, "model header")?,
            y_min: i32_at(b, 0x10, "model header")?,
            h5: i32_at(b, 0x14, "model header")?,
            vertices,
            faces,
            normals,
        })
    }

    /// Faces that reference only valid vertices (special faces can carry garbage indices).
    pub fn valid_faces(&self) -> impl Iterator<Item = &Face> {
        let nv = self.vertices.len() as u32;
        self.faces.iter().filter(move |f| f.v.iter().all(|&v| v < nv))
    }

    pub fn radius(&self) -> f32 {
        self.vertices
            .iter()
            .map(|v| {
                let [x, y, z] = v.pos.map(|c| c as f32);
                (x * x + y * y + z * z).sqrt()
            })
            .fold(0.0, f32::max)
    }

    /// Wavefront OBJ export (positions, uvs in atlas space of the face's page, normals).
    pub fn to_obj(&self) -> String {
        use std::fmt::Write;
        let mut s = format!("# SWIV 3D model {}\n", self.id);
        for v in &self.vertices {
            let _ = writeln!(s, "v {} {} {}", v.pos[0], v.pos[1], v.pos[2]);
        }
        for n in &self.normals {
            let _ = writeln!(s, "vn {} {} {}", n[0] as f32 / 100.0, n[1] as f32 / 100.0, n[2] as f32 / 100.0);
        }
        let mut vt = 1;
        let mut page = u32::MAX;
        for f in self.valid_faces() {
            if f.page() != page {
                page = f.page();
                let _ = writeln!(s, "usemtl tex{}", 12000 + page);
            }
            let (tx, ty) = ((f.tile() % 4) * 64, (f.tile() / 4) * 64);
            for uv in &f.uv {
                let u = (tx as f32 + uv[0] as f32) / 256.0;
                let v = (ty as f32 + 63.0 + uv[1] as f32) / 256.0;
                let _ = writeln!(s, "vt {u} {}", 1.0 - v);
            }
            let nn = self.normals.len() as u32;
            let idx = |j: usize| {
                let n = if f.n[j] < nn { format!("{}", f.n[j] + 1) } else { String::new() };
                format!("{}/{}/{}", f.v[j] + 1, vt + j, n)
            };
            let _ = writeln!(s, "f {} {} {}", idx(0), idx(1), idx(2));
            vt += 3;
        }
        s
    }
}
