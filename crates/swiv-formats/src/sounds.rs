//! `SOUNDS.BD`: a [`Bundle`] of RIFF/WAVE files (8-bit mono PCM, 11025 Hz).
//!
//! Directory ids are `effect * 100 + priority`, where `effect` is the number the game passes
//! to `OS_SOUND_attach_effect` / `OS_SOUND_attach_special`:
//!
//! | effect    | used by                                                  |
//! |-----------|----------------------------------------------------------|
//! | 1000-1003 | `OBFUNC_explode1..4`, crashes                            |
//! | 2000-2005 | `WEAPON_object_fire` (per weapon type)                   |
//! | 3000-3002 | player special weapons                                   |
//! | 4000/4002 | `OBJECT_pickup_base`                                     |
//! | 4001      | `GAME_handler` (warning)                                 |
//! | 4010      | ground vehicle engine; 4020 special                      |
//! | 5000-5002 | player engine loops (heli, buggy, ski)                   |
//! | 6000-6004 | landscape text / menu                                    |

use crate::bundle::Bundle;

#[derive(Debug, Clone)]
pub struct Sound<'a> {
    pub effect: u32,
    pub priority: u32,
    pub offset: usize,
    /// Complete RIFF file, playable as-is.
    pub riff: &'a [u8],
    pub sample_rate: u32,
    pub channels: u16,
    pub bits: u16,
    /// Raw PCM payload of the `data` chunk.
    pub pcm: &'a [u8],
}

fn parse_riff(effect: u32, priority: u32, offset: usize, riff: &[u8]) -> Sound<'_> {
    let (mut rate, mut ch, mut bits, mut pcm) = (11025, 1, 8, &riff[0..0]);
    let mut c = 12;
    while c + 8 <= riff.len() {
        let id = &riff[c..c + 4];
        let len = u32::from_le_bytes(riff[c + 4..c + 8].try_into().unwrap()) as usize;
        let body = &riff[c + 8..(c + 8 + len).min(riff.len())];
        if id == b"fmt " && body.len() >= 16 {
            ch = u16::from_le_bytes([body[2], body[3]]);
            rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            pcm = body;
        }
        c += 8 + len + (len & 1);
    }
    Sound { effect, priority, offset, riff, sample_rate: rate, channels: ch, bits, pcm }
}

/// All sound effects, in directory order.
pub fn split(data: &[u8]) -> Vec<Sound<'_>> {
    let Ok(b) = Bundle::parse(data.to_vec()) else { return Vec::new() };
    b.entries
        .iter()
        .filter(|e| data.get(e.offset as usize..e.offset as usize + 4) == Some(b"RIFF"))
        .map(|e| {
            let riff = &data[e.offset as usize..(e.offset + e.size) as usize];
            parse_riff(e.id / 100, e.id % 100, e.offset as usize, riff)
        })
        .collect()
}
