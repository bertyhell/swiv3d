//! Localised UI text: resource 100 of `GLOBAL.BD`.
//!
//! Header table of 8-byte rows `{u16 group, u16 lang, u32 offset}` ending with `group == 0xFFFF`.
//! Lang 0..=7 = English, Francais, Deutsch, Espanol, Italiano, Polski, Cestina, Portugues;
//! lang 99 holds language names and misc. Each group is a list of `{u32 index, u32 offset}`
//! ending with `index == 0xFFFFFFFF`; offsets point at NUL-terminated Latin-1 strings.
//! A `|` inside a string is a line break.

use crate::{u16_at, u32_at, Result};
use std::collections::BTreeMap;

pub const LANGUAGES: [&str; 8] = [
    "English", "Francais", "Deutsch", "Espanol", "Italiano", "Polski", "Cestina", "Portugues",
];

#[derive(Debug, Default, Clone)]
pub struct StringTable {
    /// (lang, group, index) -> text
    pub map: BTreeMap<(u16, u16, u32), String>,
}

impl StringTable {
    pub fn parse(res: &[u8]) -> Result<Self> {
        let mut map = BTreeMap::new();
        let mut row = 0;
        loop {
            let group = u16_at(res, row, "string header")?;
            if group == 0xffff {
                break;
            }
            let lang = u16_at(res, row + 2, "string header")?;
            let mut o = u32_at(res, row + 4, "string header")? as usize;
            loop {
                let idx = u32_at(res, o, "string group")?;
                if idx == 0xffff_ffff {
                    break;
                }
                let so = u32_at(res, o + 4, "string group")? as usize;
                let end = res[so.min(res.len())..].iter().position(|&c| c == 0).map_or(res.len(), |p| so + p);
                let text: String = res[so..end].iter().map(|&c| c as char).collect();
                map.insert((lang, group, idx), text);
                o += 8;
            }
            row += 8;
        }
        Ok(StringTable { map })
    }

    pub fn get(&self, lang: u16, group: u16, idx: u32) -> Option<&str> {
        self.map
            .get(&(lang, group, idx))
            .or_else(|| self.map.get(&(0, group, idx)))
            .map(String::as_str)
    }
}
