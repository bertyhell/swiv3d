//! swiv-pack: convert the original game data into the web layout the remake loads at startup
//! (`web/assets/`), so the page needs no CD. Maps and textures become PNGs (see
//! `swiv_formats::pack`); everything else stays in small bundles.
//!
//! Usage: swiv-pack <GameData dir> <out dir, e.g. web/assets> [--music <dir of trackNN.mp3>]

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use swiv_formats::{bundle::Bundle, level::{Level, NEUTRAL_SHADE}, pack, sounds};

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: swiv-pack <GameData dir> <out dir> [--music DIR]");
        std::process::exit(2);
    }
    let music = args.iter().position(|a| a == "--music").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if let Err(e) = run(Path::new(&args[1]), Path::new(&args[2]), music) {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

/// An 8-bit PNG: grey when `palette` is None, otherwise indexed (index 0 transparent if `trns`).
fn png(path: &Path, w: u32, h: u32, pixels: &[u8], palette: Option<&[[u8; 3]]>, trns: bool) -> Res<()> {
    let mut enc = png::Encoder::new(fs::File::create(path)?, w, h);
    enc.set_depth(png::BitDepth::Eight);
    match palette {
        None => enc.set_color(png::ColorType::Grayscale),
        Some(p) => {
            enc.set_color(png::ColorType::Indexed);
            enc.set_palette(p.iter().flatten().copied().collect::<Vec<u8>>());
            if trns {
                enc.set_trns(vec![0u8]);
            }
        }
    }
    enc.set_compression(png::Compression::Best);
    enc.write_header()?.write_image_data(pixels)?;
    Ok(())
}

fn run(data: &Path, out: &Path, music: Option<PathBuf>) -> Res<()> {
    fs::create_dir_all(out)?;
    let mut manifest = String::from("{\n  \"levels\": {");
    let mut levels: Vec<_> = fs::read_dir(data)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("slv")))
        .collect();
    levels.sort();
    let mut bytes = 0u64;
    for (k, p) in levels.iter().enumerate() {
        let name = p.file_stem().unwrap().to_string_lossy().to_uppercase();
        let l = Level::parse(fs::read(p)?)?;
        let dir = out.join("levels").join(&name);
        fs::create_dir_all(dir.join("tex"))?;
        png(&dir.join("height.png"), 512, 512, &l.hmap, None, false)?;
        png(&dir.join("type.png"), 512, 512, &l.tmap, None, false)?;
        png(&dir.join("colour.png"), 512, 512, &l.mmap, Some(&l.palette), false)?;
        let mut ids = Vec::new();
        for t in &l.textures {
            let colours: Vec<[u8; 3]> = (0..256).map(|i| l.palette[t.shade[NEUTRAL_SHADE * 256 + i] as usize]).collect();
            png(&dir.join("tex").join(format!("{}.png", t.id)), 256, t.height() as u32, &t.texels, Some(&colours), true)?;
            ids.push(t.id.to_string());
        }
        fs::write(dir.join("level.bd"), pack::slim_level_bundle(&l.bundle))?;
        bytes += fs::read_dir(&dir)?.chain(fs::read_dir(dir.join("tex"))?).filter_map(|e| e.ok()?.metadata().ok()).map(|m| m.len()).sum::<u64>();
        let _ = write!(manifest, "{}\n    \"{name}\": {{ \"textures\": [{}] }}", if k > 0 { "," } else { "" }, ids.join(", "));
        println!("{name}: {} texture pages", ids.len());
    }
    manifest.push_str("\n  },\n");

    // Global data: strings + 3D font. The full-screen images (1000..1003) are not used.
    let global = Bundle::parse(fs::read(data.join("GLOBAL.BD"))?)?;
    let keep: Vec<(u32, &[u8])> = global.entries.iter().filter(|e| e.id < 1000).map(|e| (e.id, global.get(e.id).unwrap())).collect();
    fs::write(out.join("global.bd"), Bundle::write(&keep))?;

    // Sound effects as WAV files named by effect id.
    let snd = fs::read(data.join("SOUNDS.BD"))?;
    fs::create_dir_all(out.join("sounds"))?;
    let mut effects = Vec::new();
    for s in sounds::split(&snd) {
        fs::write(out.join("sounds").join(format!("{}.wav", s.effect)), s.riff)?;
        effects.push(s.effect.to_string());
    }
    let _ = writeln!(manifest, "  \"sounds\": [{}],", effects.join(", "));

    // CD music, already ripped (the project keeps it in mp3/).
    let mut tracks = Vec::new();
    if let Some(m) = music {
        fs::create_dir_all(out.join("music"))?;
        let mut files: Vec<_> = fs::read_dir(&m)?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "mp3")).collect();
        files.sort();
        for f in files {
            let n = f.file_name().unwrap().to_string_lossy().to_string();
            fs::copy(&f, out.join("music").join(&n))?;
            tracks.push(format!("\"{n}\""));
        }
    }
    let _ = writeln!(manifest, "  \"music\": [{}]\n}}", tracks.join(", "));
    fs::write(out.join("manifest.json"), manifest)?;
    println!("levels: {} ({:.1} MB), sounds: {}, music tracks: {}", levels.len(), bytes as f64 / 1e6, effects.len(), tracks.len());
    Ok(())
}
