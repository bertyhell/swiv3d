//! A level (`*.SLV`): a [`Bundle`] with these resources (names from `LEVEL_initlevel`):
//!
//! | id    | symbol             | contents                                              |
//! |-------|--------------------|-------------------------------------------------------|
//! | 100   | `LSCAPE_Hmap`      | 512x512 u8 heights, wraps; world height = h << 10     |
//! | 102   | `LSCAPE_Tmap`      | 512x512 u8 per-cell type (0 = water)                  |
//! | 103   | `LSCAPE_Mmap`      | 512x512 u8 pre-shaded colour map (palette indices)    |
//! | 104   | –                  | level settings table                                  |
//! | 105   | `start_objects`    | 64-byte spawn records, ended by class -1             |
//! | 106   | `LEVEL_lowdet`     | 128x128 low detail map                                |
//! | 107   | `nodetab`          | AI path nodes                                         |
//! | 108   | `GLOBAL_alphatab`  | 256x256 blend table                                   |
//! | 109   | `GLOBAL_flametab`  | 32 KiB flame colour table                             |
//! | 110   | `LEVEL_shadowmap`  | 256x256                                               |
//! | 500/501 | `rotdat`/`wheeldat` | rotor/wheel animation data                       |
//! | 10xxx | `raw_models`       | 3D models, see [`crate::model`]                      |
//! | 11003 | `system_pal`       | 768-byte 6-bit VGA palette + 0x2000 translucency table|
//! | 11004 | `LEVEL_debris`     | debris definitions                                    |
//! | 12xxx | `TEX_dat`/`TEX_flt`| texture page: 256-byte name, 128x256 shade LUT, 256 x n texels |
//!
//! World units: one map cell is `1 << 14`. Spawn positions are in 1/64 cell (`<< 8`).

use crate::{bundle::Bundle, i32_at, model::Model, vga_palette, Error, Result};
use std::collections::BTreeMap;

pub const MAP_SIZE: usize = 512;
pub const CELL_SHIFT: u32 = 14;
pub const HEIGHT_SHIFT: u32 = 10;
pub const SPAWN_SHIFT: u32 = 8;

pub const RES_HMAP: u32 = 100;
pub const RES_TMAP: u32 = 102;
pub const RES_MMAP: u32 = 103;
pub const RES_SETTINGS: u32 = 104;
pub const RES_SPAWNS: u32 = 105;
pub const RES_LOWDET: u32 = 106;
pub const RES_NODES: u32 = 107;
pub const RES_PALETTE: u32 = 11003;

/// Shade LUT row that reproduces the texture's own colours (0 = black, 127 = fog).
pub const NEUTRAL_SHADE: usize = 64;
pub const SHADE_ROWS: usize = 128;

#[derive(Debug, Clone)]
pub struct TexturePage {
    pub id: u32,
    pub name: String,
    /// `shade[row * 256 + texel]` -> palette index.
    pub shade: Vec<u8>,
    /// 256 texels wide, 256 rows (512 for page 12000, the ground strip indexed by `Tmap`);
    /// texture-local indices, 0 is transparent on see-through faces.
    pub texels: Vec<u8>,
}

impl TexturePage {
    /// The 256-byte name and shade LUT that precede the texels.
    pub const HEADER: usize = 0x8100;

    pub fn parse(id: u32, b: &[u8]) -> Result<Self> {
        if b.len() < 0x18100 {
            return Err(Error::Truncated { what: "texture page", offset: b.len() });
        }
        Self::from_parts(id, &b[..Self::HEADER], b[Self::HEADER..Self::HEADER + (b.len() - Self::HEADER) / 256 * 256].to_vec())
    }

    /// A page from its header (name + shade LUT) and its texels stored apart (see [`crate::pack`]).
    pub fn from_parts(id: u32, header: &[u8], texels: Vec<u8>) -> Result<Self> {
        let b = header;
        if b.len() < Self::HEADER || texels.len() < 256 * 256 || texels.len() % 256 != 0 {
            return Err(Error::Truncated { what: "texture page", offset: b.len() });
        }
        let name_end = b[..0x100].iter().position(|&c| c == 0).unwrap_or(0x100);
        Ok(TexturePage {
            id,
            name: b[..name_end].iter().map(|&c| c as char).collect(),
            shade: b[0x100..0x8100].to_vec(),
            texels,
        })
    }

    pub fn height(&self) -> usize {
        self.texels.len() / 256
    }

    /// RGBA image at a given shade row; texel 0 gets alpha 0.
    pub fn rgba(&self, palette: &[[u8; 3]; 256], row: usize) -> Vec<u8> {
        let lut = &self.shade[row * 256..row * 256 + 256];
        let mut out = Vec::with_capacity(self.texels.len() * 4);
        for &t in &self.texels {
            let c = palette[lut[t as usize] as usize];
            out.extend_from_slice(&[c[0], c[1], c[2], if t == 0 { 0 } else { 255 }]);
        }
        out
    }
}

/// One record of `start_objects` (64 bytes = 16 x i32).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spawn {
    /// Behaviour class, dispatched in `GAME_Setup` (see [`SpawnKind`]).
    pub class: i32,
    /// Position in 1/64 map cell.
    pub x: i32,
    pub z: i32,
    /// Heading, 512 = full turn.
    pub angle: i32,
    /// Primary model (`10000 + model`).
    pub model: i32,
    /// Secondary model / parameter (turret top, destroyed version, pickup type ...).
    pub model2: i32,
    pub params: [i32; 10],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpawnKind {
    PlayerStart,
    Scenery,
    Turret,
    Pillbox,
    Aircraft,
    Drone,
    Tank,
    Boat,
    Spawner,
    Pickup,
    Teleport,
    Boss,
    Other,
}

impl Spawn {
    /// Classification derived from the `cmp eax, <class>` tree in `GAME_Setup`.
    pub fn kind(&self) -> SpawnKind {
        match self.class {
            1000 | 1001 => SpawnKind::PlayerStart,
            2000..=2004 => SpawnKind::Scenery,
            3000 | 3002 | 3100 => SpawnKind::Turret,
            3001 => SpawnKind::Pillbox,
            4001 | 4002 => SpawnKind::Aircraft,
            4100 | 4101 => SpawnKind::Drone,
            5000..=5010 => SpawnKind::Tank,
            5500..=5510 => SpawnKind::Boat,
            6000..=6299 => SpawnKind::Spawner,
            7000..=7002 => SpawnKind::Pickup,
            7010..=7999 => SpawnKind::Teleport,
            3200 | 8000..=9999 => SpawnKind::Boss,
            _ => SpawnKind::Other,
        }
    }

    pub fn world_pos(&self) -> (i32, i32) {
        (self.x << SPAWN_SHIFT, self.z << SPAWN_SHIFT)
    }
}

#[derive(Debug, Clone)]
pub struct Level {
    pub bundle: Bundle,
    pub hmap: Vec<u8>,
    pub tmap: Vec<u8>,
    pub mmap: Vec<u8>,
    pub palette: [[u8; 3]; 256],
    pub textures: Vec<TexturePage>,
    pub models: BTreeMap<u32, Model>,
    pub spawns: Vec<Spawn>,
    /// What objects break into (empty when the level has no `LEVEL_debris`).
    pub debris: crate::debris::Debris,
}

fn map(b: &Bundle, id: u32) -> Result<Vec<u8>> {
    let r = b.require(id)?;
    if r.len() < MAP_SIZE * MAP_SIZE {
        return Err(Error::Truncated { what: "map", offset: r.len() });
    }
    Ok(r[..MAP_SIZE * MAP_SIZE].to_vec())
}

impl Level {
    pub fn parse(data: Vec<u8>) -> Result<Level> {
        let bundle = Bundle::parse(data)?;
        let hmap = map(&bundle, RES_HMAP)?;
        let tmap = map(&bundle, RES_TMAP)?;
        let mmap = map(&bundle, RES_MMAP)?;
        let mut textures = Vec::new();
        for (e, b) in bundle.group(12) {
            textures.push(TexturePage::parse(e.id, b)?);
        }
        Self::assemble(bundle, hmap, tmap, mmap, textures)
    }

    /// A level whose maps and texels were stored as images beside a slim bundle holding
    /// everything else (see [`crate::pack`]).
    pub fn from_parts(bundle: Bundle, hmap: Vec<u8>, tmap: Vec<u8>, mmap: Vec<u8>, texels: Vec<(u32, Vec<u8>)>) -> Result<Level> {
        for m in [&hmap, &tmap, &mmap] {
            if m.len() != MAP_SIZE * MAP_SIZE {
                return Err(Error::Truncated { what: "map", offset: m.len() });
            }
        }
        let mut textures = Vec::new();
        for (id, t) in texels {
            textures.push(TexturePage::from_parts(id, bundle.require(id)?, t)?);
        }
        Self::assemble(bundle, hmap, tmap, mmap, textures)
    }

    fn assemble(bundle: Bundle, hmap: Vec<u8>, tmap: Vec<u8>, mmap: Vec<u8>, mut textures: Vec<TexturePage>) -> Result<Level> {
        let palette = vga_palette(bundle.require(RES_PALETTE)?);
        textures.sort_by_key(|t| t.id);
        let mut models = BTreeMap::new();
        for (e, b) in bundle.group(10) {
            models.insert(e.id, Model::parse(e.id, b)?);
        }
        let mut spawns = Vec::new();
        let sb = bundle.require(RES_SPAWNS)?;
        for k in 0..sb.len() / 64 {
            let o = k * 64;
            let w = |i: usize| i32_at(sb, o + i * 4, "spawn");
            let class = w(0)?;
            if class == -1 {
                break;
            }
            let mut params = [0; 10];
            for (i, p) in params.iter_mut().enumerate() {
                *p = w(6 + i)?;
            }
            spawns.push(Spawn { class, x: w(1)?, z: w(2)?, angle: w(3)?, model: w(4)?, model2: w(5)?, params });
        }
        let debris = match bundle.get(crate::debris::RES_DEBRIS) {
            Some(b) => crate::debris::Debris::parse(b)?,
            None => Default::default(),
        };
        Ok(Level { bundle, hmap, tmap, mmap, palette, textures, models, spawns, debris })
    }

    pub fn texture(&self, page: u32) -> Option<&TexturePage> {
        self.textures.iter().find(|t| t.id == 12000 + page)
    }

    pub fn model(&self, index: i32) -> Option<&Model> {
        self.models.get(&(10000 + index as u32))
    }

    #[inline]
    pub fn cell(map: &[u8], cx: i32, cz: i32) -> u8 {
        map[((cz & 0x1ff) as usize) << 9 | (cx & 0x1ff) as usize]
    }

    /// Port of `LSCAPE_GetMapH`: bilinear height at world (x, z), result in world units.
    pub fn height_at(&self, x: i32, z: i32) -> i32 {
        let (cx, cz) = (x >> CELL_SHIFT, z >> CELL_SHIFT);
        let (fx, fz) = ((x >> 6) & 0xff, (z >> 6) & 0xff);
        let h = |dx: i32, dz: i32| (Self::cell(&self.hmap, cx + dx, cz + dz) as i32) << HEIGHT_SHIFT;
        let (h00, h10, h01, h11) = (h(0, 0), h(1, 0), h(0, 1), h(1, 1));
        let top = h00 + (((h10 - h00) * fx) >> 8);
        let bot = h01 + (((h11 - h01) * fx) >> 8);
        top + (((bot - top) * fz) >> 8)
    }

    /// Mmap as RGB (512x512), the level's top-down colour image.
    pub fn colour_map_rgb(&self) -> Vec<u8> {
        self.mmap.iter().flat_map(|&i| self.palette[i as usize]).collect()
    }
}
