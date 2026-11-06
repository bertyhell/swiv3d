//! The unpacked web layout written by `swiv-pack`: each level's maps and texture texels as
//! 8-bit PNGs (viewable, and lossless for the raw values the game uses) beside a slim
//! `level.bd` holding everything that is not an image.
//!
//! ```text
//! levels/<NAME>/height.png    grey, LSCAPE_Hmap
//! levels/<NAME>/type.png      grey, LSCAPE_Tmap
//! levels/<NAME>/colour.png    indexed with the level palette, LSCAPE_Mmap
//! levels/<NAME>/tex/<id>.png  indexed with the page's own colours (shade row 64), index 0
//!                             transparent; the indices are the page's texels
//! levels/<NAME>/level.bd      the .SLV minus maps and texels (texture pages keep their
//!                             name + shade LUT header)
//! ```

use crate::{bundle::Bundle, level::{TexturePage, RES_HMAP, RES_MMAP, RES_TMAP}, Error, Result};

/// The raw 8-bit samples of a grey or indexed PNG (palette indices are not expanded).
pub fn decode_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>)> {
    let bad = |_| Error::BadDirectory("unreadable PNG");
    let mut dec = png::Decoder::new(bytes);
    dec.set_transformations(png::Transformations::IDENTITY);
    let mut r = dec.read_info().map_err(bad)?;
    let mut buf = vec![0; r.output_buffer_size()];
    let info = r.next_frame(&mut buf).map_err(bad)?;
    if info.bit_depth != png::BitDepth::Eight || !matches!(info.color_type, png::ColorType::Grayscale | png::ColorType::Indexed) {
        return Err(Error::BadDirectory("PNG is not 8-bit grey or indexed"));
    }
    buf.truncate(info.buffer_size());
    Ok((info.width, info.height, buf))
}

/// The level bundle without its maps, and with texture pages cut down to their header.
pub fn slim_level_bundle(b: &Bundle) -> Vec<u8> {
    let keep: Vec<(u32, &[u8])> = b
        .entries
        .iter()
        .filter(|e| ![RES_HMAP, RES_TMAP, RES_MMAP].contains(&e.id))
        .map(|e| {
            let r = b.get(e.id).unwrap_or(&[]);
            (e.id, if e.id / 1000 == 12 { &r[..TexturePage::HEADER.min(r.len())] } else { r })
        })
        .collect();
    Bundle::write(&keep)
}
