//! Parsers for the SWIV 3D (1996) data files.
//!
//! All formats were reverse-engineered from `swiv_win.exe` (Watcom debug symbols intact);
//! see `docs/formats.md` for the byte-level description.

pub mod bundle;
pub mod debris;
pub mod font3d;
pub mod level;
pub mod model;
pub mod pack;
pub mod sounds;
pub mod strings;

pub use bundle::Bundle;
pub use level::Level;
pub use model::Model;

#[derive(Debug)]
pub enum Error {
    Truncated { what: &'static str, offset: usize },
    BadDirectory(&'static str),
    MissingResource(u32),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Truncated { what, offset } => write!(f, "{what} truncated at offset {offset:#x}"),
            Error::BadDirectory(why) => write!(f, "bad bundle directory: {why}"),
            Error::MissingResource(id) => write!(f, "resource {id} not found"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn u16_at(b: &[u8], o: usize, what: &'static str) -> Result<u16> {
    b.get(o..o + 2)
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
        .ok_or(Error::Truncated { what, offset: o })
}

pub(crate) fn i16_at(b: &[u8], o: usize, what: &'static str) -> Result<i16> {
    u16_at(b, o, what).map(|v| v as i16)
}

pub(crate) fn u32_at(b: &[u8], o: usize, what: &'static str) -> Result<u32> {
    b.get(o..o + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or(Error::Truncated { what, offset: o })
}

pub(crate) fn i32_at(b: &[u8], o: usize, what: &'static str) -> Result<i32> {
    u32_at(b, o, what).map(|v| v as i32)
}

/// Expand a 6-bit VGA palette (768 bytes, 0..=63) to 8-bit RGB.
pub fn vga_palette(raw: &[u8]) -> [[u8; 3]; 256] {
    let mut pal = [[0u8; 3]; 256];
    for (i, c) in pal.iter_mut().enumerate() {
        for k in 0..3 {
            let v = raw.get(i * 3 + k).copied().unwrap_or(0) & 0x3f;
            c[k] = (v << 2) | (v >> 4);
        }
    }
    pal
}
