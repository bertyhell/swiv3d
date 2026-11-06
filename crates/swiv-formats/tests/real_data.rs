//! Runs against the original game files when `SWIV_DATA` points at a `GameData` directory.
use swiv_formats::{bundle::Bundle, level::Level, sounds, strings::StringTable};

fn data_dir() -> Option<std::path::PathBuf> {
    let p = std::path::PathBuf::from(std::env::var("SWIV_DATA").ok()?);
    p.join("GLOBAL.BD").exists().then_some(p)
}

#[test]
fn every_level_parses() {
    let Some(dir) = data_dir() else { return eprintln!("SWIV_DATA not set, skipping") };
    let mut n = 0;
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("slv")) {
            let lvl = Level::parse(std::fs::read(&p).unwrap()).unwrap_or_else(|e| panic!("{p:?}: {e}"));
            assert!(!lvl.spawns.is_empty(), "{p:?} has no spawns");
            assert!(!lvl.models.is_empty() && !lvl.textures.is_empty());
            assert!(lvl.spawns.iter().any(|s| s.class == 1000 || s.class == 1001), "{p:?} no player start");
            n += 1;
        }
    }
    assert_eq!(n, 18);
}

#[test]
fn global_strings_and_sounds() {
    let Some(dir) = data_dir() else { return };
    let g = Bundle::parse(std::fs::read(dir.join("GLOBAL.BD")).unwrap()).unwrap();
    let t = StringTable::parse(g.require(100).unwrap()).unwrap();
    assert_eq!(t.get(99, 0, 0), Some("English"));
    assert_eq!(t.get(0, 0, 0), Some("Select|Pilot"));
    let s = std::fs::read(dir.join("SOUNDS.BD")).unwrap();
    let snd = sounds::split(&s);
    assert_eq!(snd.len(), 26);
    assert!(snd.iter().any(|x| x.effect == 5000), "heli engine loop");
    assert!(snd.iter().all(|x| x.sample_rate > 0 && !x.pcm.is_empty()));
}

#[test]
fn three_d_font() {
    let Some(dir) = data_dir() else { return };
    let g = Bundle::parse(std::fs::read(dir.join("GLOBAL.BD")).unwrap()).unwrap();
    let f = swiv_formats::font3d::Font3d::parse(g.require(swiv_formats::font3d::RES_3DFONT).unwrap()).unwrap();
    for c in ('A'..='Z').chain('0'..='9').chain(['%', '!']) {
        let gl = f.glyph(c).unwrap();
        assert!(!gl.faces.is_empty(), "{c} has no faces");
        let xs = gl.vertices.iter().map(|v| v[0]);
        assert!((xs.clone().max().unwrap() - gl.half_width).abs() <= 1 && (xs.min().unwrap() + gl.half_width).abs() <= 1, "{c} is centred");
    }
    assert_eq!(f.glyph('a').unwrap().faces.len(), f.glyph('A').unwrap().faces.len());
    assert!(f.glyph(' ').unwrap().faces.is_empty() && f.glyph(' ').unwrap().half_width > 0);
}

#[test]
fn debris_table() {
    let Some(dir) = data_dir() else { return };
    let l = Level::parse(std::fs::read(dir.join("TERRAN01.SLV")).unwrap()).unwrap();
    use swiv_formats::debris::{DESTROYED, REMAINS};
    assert_eq!(l.debris.get(500, REMAINS), [712, 713, 714]);
    assert_eq!(l.debris.get(560, REMAINS), [761, 762, 763, 764, 765, 766]);
    assert_eq!(l.debris.get(990, DESTROYED), [700, 701, 702, 703]);
}

/// The web layout written by `swiv-pack` (in `web/assets`) must rebuild every level exactly.
#[test]
fn packed_levels_match_the_originals() {
    let Some(dir) = data_dir() else { return };
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/assets/levels");
    if !assets.exists() {
        return eprintln!("web/assets not packed, skipping");
    }
    use swiv_formats::pack::decode_png;
    let mut n = 0;
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("slv")) {
            continue;
        }
        let name = p.file_stem().unwrap().to_string_lossy().to_uppercase();
        let a = Level::parse(std::fs::read(&p).unwrap()).unwrap();
        let d = assets.join(&name);
        let map = |f: &str| decode_png(&std::fs::read(d.join(f)).unwrap()).unwrap().2;
        let texels = a.textures.iter().map(|t| (t.id, map(&format!("tex/{}.png", t.id)))).collect();
        let bundle = Bundle::parse(std::fs::read(d.join("level.bd")).unwrap()).unwrap();
        let b = Level::from_parts(bundle, map("height.png"), map("type.png"), map("colour.png"), texels).unwrap();
        assert!(a.hmap == b.hmap && a.tmap == b.tmap && a.mmap == b.mmap, "{name} maps");
        assert_eq!(a.palette, b.palette, "{name} palette");
        assert_eq!(a.models.len(), b.models.len(), "{name} models");
        assert_eq!(a.spawns.len(), b.spawns.len(), "{name} spawns");
        for (x, y) in a.textures.iter().zip(&b.textures) {
            assert!(x.id == y.id && x.shade == y.shade && x.texels == y.texels, "{name} texture {}", x.id);
        }
        assert_eq!(a.debris.lists, b.debris.lists, "{name} debris");
        n += 1;
    }
    assert_eq!(n, 18);
}
