//! The "BD" container used by `GLOBAL.BD` and every `*.SLV` level.
//!
//! The directory sits at the *end* of the file: 12-byte entries `{u32 offset, u32 size, u32 id}`.
//! The final entry has `id == 0` and its offset field holds the entry count (including itself).
//! The game loads the whole file and looks resources up by id (`LEVEL_make_ref`).

use crate::{u32_at, Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub id: u32,
    pub offset: u32,
    pub size: u32,
}

#[derive(Debug, Clone)]
pub struct Bundle {
    pub data: Vec<u8>,
    pub entries: Vec<Entry>,
}

impl Bundle {
    pub fn parse(data: Vec<u8>) -> Result<Self> {
        let len = data.len();
        if len < 12 {
            return Err(Error::BadDirectory("file smaller than one entry"));
        }
        let count = u32_at(&data, len - 12, "directory count")? as usize;
        if count == 0 || count * 12 > len {
            return Err(Error::BadDirectory("entry count out of range"));
        }
        let start = len - count * 12;
        let mut entries = Vec::with_capacity(count - 1);
        for k in 0..count - 1 {
            let o = start + k * 12;
            let e = Entry {
                offset: u32_at(&data, o, "entry")?,
                size: u32_at(&data, o + 4, "entry")?,
                id: u32_at(&data, o + 8, "entry")?,
            };
            if e.offset as usize + e.size as usize > start {
                return Err(Error::BadDirectory("entry points past directory"));
            }
            entries.push(e);
        }
        if u32_at(&data, len - 4, "terminator")? != 0 {
            return Err(Error::BadDirectory("missing terminator entry"));
        }
        Ok(Bundle { data, entries })
    }

    pub fn entry(&self, id: u32) -> Option<Entry> {
        self.entries.iter().copied().find(|e| e.id == id)
    }

    pub fn get(&self, id: u32) -> Option<&[u8]> {
        self.entry(id)
            .map(|e| &self.data[e.offset as usize..(e.offset + e.size) as usize])
    }

    pub fn require(&self, id: u32) -> Result<&[u8]> {
        self.get(id).ok_or(Error::MissingResource(id))
    }

    /// Build a bundle in the game's layout from `(id, bytes)` resources.
    pub fn write(resources: &[(u32, &[u8])]) -> Vec<u8> {
        let mut data = Vec::new();
        let mut dir = Vec::new();
        for &(id, bytes) in resources {
            dir.push((data.len() as u32, bytes.len() as u32, id));
            data.extend_from_slice(bytes);
        }
        dir.push((dir.len() as u32 + 1, 0, 0));
        for (o, s, i) in dir {
            data.extend(o.to_le_bytes());
            data.extend(s.to_le_bytes());
            data.extend(i.to_le_bytes());
        }
        data
    }

    /// Entries whose id falls in the group `id / 1000 == group` (e.g. 10 = models, 12 = textures).
    pub fn group(&self, group: u32) -> impl Iterator<Item = (Entry, &[u8])> {
        self.entries.iter().filter(move |e| e.id / 1000 == group).map(move |e| {
            (*e, &self.data[e.offset as usize..(e.offset + e.size) as usize])
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_synthetic_bundle() {
        let mut d = b"hello world!".to_vec();
        for (o, s, i) in [(0u32, 5u32, 7u32), (6, 6, 8), (3, 0, 0)] {
            d.extend(o.to_le_bytes());
            d.extend(s.to_le_bytes());
            d.extend(i.to_le_bytes());
        }
        let b = Bundle::parse(d).unwrap();
        assert_eq!(b.get(7), Some(&b"hello"[..]));
        assert_eq!(b.get(8), Some(&b"world!"[..]));
        assert!(b.get(9).is_none());
        let w = Bundle::parse(Bundle::write(&[(7, b"hello"), (8, b"world!")])).unwrap();
        assert_eq!((w.get(7), w.get(8)), (Some(&b"hello"[..]), Some(&b"world!"[..])));
    }
}
