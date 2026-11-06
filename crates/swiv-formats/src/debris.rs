//! `LEVEL_debris` (level resource 11004): what objects break into, per model.
//!
//! A linked list of nodes, each `{i32 next, i32 first_entry, i32 key}` with
//! `key = variant << 16 | model`; the entries form a ring `{u32 data, i32 next, i32 model}`
//! back to `first_entry` (offsets from the resource start). The variants, read against the
//! footage: 0 = what is left standing (one is picked: house rubble, tree stumps), 1 = pieces
//! thrown out when the object is destroyed (rubble chunks, tree leaves), 2 = chips knocked
//! off while it is being hit. `data` is not decoded yet.

use crate::{i32_at, Result};
use std::collections::HashMap;

pub const RES_DEBRIS: u32 = 11004;

pub const REMAINS: u16 = 0;
pub const DESTROYED: u16 = 1;
pub const HIT: u16 = 2;

#[derive(Debug, Clone, Default)]
pub struct Debris {
    /// (model, variant) -> debris models.
    pub lists: HashMap<(i32, u16), Vec<i32>>,
}

impl Debris {
    pub fn parse(b: &[u8]) -> Result<Debris> {
        let mut lists = HashMap::new();
        let mut node = 0usize;
        let mut seen = std::collections::HashSet::new();
        while node + 12 <= b.len() && seen.insert(node) {
            let next = i32_at(b, node, "debris node")?;
            let first = i32_at(b, node + 4, "debris node")?;
            let key = i32_at(b, node + 8, "debris node")?;
            let mut models = Vec::new();
            let mut e = first;
            for _ in 0..32 {
                if e <= 0 || e as usize + 12 > b.len() {
                    break;
                }
                models.push(i32_at(b, e as usize + 8, "debris entry")?);
                e = i32_at(b, e as usize + 4, "debris entry")?;
                if e == first {
                    break;
                }
            }
            lists.insert((key & 0xffff, (key >> 16) as u16), models);
            if next as usize <= node {
                break;
            }
            node = next as usize;
        }
        Ok(Debris { lists })
    }

    pub fn get(&self, model: i32, variant: u16) -> &[i32] {
        self.lists.get(&(model, variant)).map_or(&[], |v| v.as_slice())
    }
}
