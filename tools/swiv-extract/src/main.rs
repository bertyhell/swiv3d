//! swiv-extract: dump the original SWIV 3D data to PNG / OBJ / WAV / JSON (and OGG/WebM via ffmpeg).
//!
//! Usage: swiv-extract <GameData dir> <out dir> [--anims <Anims dir>] [--cue <swiv3d.cue>]

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use swiv_formats::{bundle::Bundle, level::Level, sounds, strings::StringTable};

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: swiv-extract <GameData dir> <out dir> [--anims DIR] [--cue FILE.cue]");
        std::process::exit(2);
    }
    let (data, out) = (PathBuf::from(&args[1]), PathBuf::from(&args[2]));
    let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if let Err(e) = run(&data, &out, opt("--anims"), opt("--cue")) {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run(data: &Path, out: &Path, anims: Option<PathBuf>, cue: Option<PathBuf>) -> Res<()> {
    fs::create_dir_all(out)?;
    let global = Bundle::parse(fs::read(data.join("GLOBAL.BD"))?)?;
    extract_global(&global, &out.join("global"))?;
    let snd = fs::read(data.join("SOUNDS.BD"))?;
    let sdir = out.join("sounds");
    fs::create_dir_all(&sdir)?;
    let list = sounds::split(&snd);
    for (i, s) in list.iter().enumerate() {
        let _ = i;
        fs::write(sdir.join(sounds::file_name(s.effect)), s.riff)?;
    }
    println!("sounds: {}", list.len());

    let mut levels: Vec<_> = fs::read_dir(data)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("slv")))
        .collect();
    levels.sort();
    for p in levels {
        let name = p.file_stem().unwrap().to_string_lossy().to_uppercase();
        let lvl = Level::parse(fs::read(&p)?)?;
        extract_level(&lvl, &out.join("levels").join(&name))?;
        println!("{name}: {} models, {} textures, {} spawns", lvl.models.len(), lvl.textures.len(), lvl.spawns.len());
    }
    if let Some(a) = anims {
        convert_videos(&a, &out.join("video"))?;
    }
    if let Some(c) = cue {
        rip_music(&c, &out.join("music"))?;
    }
    Ok(())
}

fn write_png(path: &Path, w: u32, h: u32, color: png::ColorType, pixels: &[u8]) -> Res<()> {
    let mut enc = png::Encoder::new(fs::File::create(path)?, w, h);
    enc.set_color(color);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()?.write_image_data(pixels)?;
    Ok(())
}

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => {
                let _ = write!(o, "\\u{:04x}", c as u32);
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn extract_global(g: &Bundle, dir: &Path) -> Res<()> {
    fs::create_dir_all(dir)?;
    let t = StringTable::parse(g.require(100)?)?;
    let mut j = String::from("[\n");
    for (i, ((lang, group, idx), text)) in t.map.iter().enumerate() {
        let _ = writeln!(
            j,
            "  {{\"lang\":{lang},\"group\":{group},\"index\":{idx},\"text\":{}}}{}",
            json_str(text),
            if i + 1 < t.map.len() { "," } else { "" }
        );
    }
    j.push(']');
    fs::write(dir.join("strings.json"), j)?;
    println!("strings: {}", t.map.len());
    Ok(())
}

fn extract_level(l: &Level, dir: &Path) -> Res<()> {
    let (tdir, mdir) = (dir.join("textures"), dir.join("models"));
    fs::create_dir_all(&tdir)?;
    fs::create_dir_all(&mdir)?;
    write_png(&dir.join("height.png"), 512, 512, png::ColorType::Grayscale, &l.hmap)?;
    write_png(&dir.join("type.png"), 512, 512, png::ColorType::Grayscale, &l.tmap)?;
    write_png(&dir.join("colour.png"), 512, 512, png::ColorType::Rgb, &l.colour_map_rgb())?;
    let pal: Vec<u8> = l.palette.iter().flatten().copied().collect();
    write_png(&dir.join("palette.png"), 256, 1, png::ColorType::Rgb, &pal)?;
    let mut mtl = String::new();
    for t in &l.textures {
        let rgba = t.rgba(&l.palette, swiv_formats::level::NEUTRAL_SHADE);
        write_png(&tdir.join(format!("{}.png", t.id)), 256, t.height() as u32, png::ColorType::Rgba, &rgba)?;
        let _ = writeln!(mtl, "newmtl tex{}\nmap_Kd ../textures/{}.png\n", t.id, t.id);
    }
    fs::write(mdir.join("models.mtl"), &mtl)?;
    for m in l.models.values() {
        fs::write(mdir.join(format!("{}.obj", m.id)), format!("mtllib models.mtl\n{}", m.to_obj()))?;
    }
    let mut j = String::from("[\n");
    for (i, s) in l.spawns.iter().enumerate() {
        let _ = writeln!(
            j,
            "  {{\"class\":{},\"kind\":\"{:?}\",\"x\":{},\"z\":{},\"angle\":{},\"model\":{},\"model2\":{},\"params\":{:?}}}{}",
            s.class,
            s.kind(),
            s.x,
            s.z,
            s.angle,
            s.model,
            s.model2,
            s.params,
            if i + 1 < l.spawns.len() { "," } else { "" }
        );
    }
    j.push(']');
    fs::write(dir.join("spawns.json"), j)?;
    Ok(())
}

fn have(tool: &str) -> bool {
    Command::new(tool).arg("-version").output().is_ok() || Command::new("which").arg(tool).output().is_ok_and(|o| o.status.success())
}

fn convert_videos(anims: &Path, out: &Path) -> Res<()> {
    if !have("ffmpeg") {
        eprintln!("ffmpeg not found: skipping videos");
        return Ok(());
    }
    fs::create_dir_all(out)?;
    for e in fs::read_dir(anims)? {
        let p = e?.path();
        if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("smk")) {
            let name = p.file_stem().unwrap().to_string_lossy().to_uppercase();
            let dst = out.join(format!("{name}.webm"));
            let ok = Command::new("ffmpeg")
                .args(["-y", "-loglevel", "error", "-i"])
                .arg(&p)
                .args(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus"])
                .arg(&dst)
                .status()?
                .success();
            println!("video {name}: {}", if ok { "ok" } else { "FAILED" });
        }
        if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("scr")) {
            let name = p.file_stem().unwrap().to_string_lossy().to_uppercase();
            fs::copy(&p, out.join(format!("{name}.SCR")))?;
        }
    }
    Ok(())
}

/// Red Book audio tracks straight out of the BIN (raw 2352-byte sectors, 16-bit stereo 44.1 kHz).
fn rip_music(cue: &Path, out: &Path) -> Res<()> {
    fs::create_dir_all(out)?;
    let tracks = parse_cue(&fs::read_to_string(cue)?);
    let bin_name = fs::read_to_string(cue)?
        .lines()
        .find_map(|l| l.trim().strip_prefix("FILE \"").and_then(|r| r.split('"').next()).map(str::to_string))
        .ok_or("no FILE in cue")?;
    let dir = cue.parent().unwrap_or(Path::new("."));
    let bin = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&bin_name)))
        .ok_or("bin file not found")?;
    let total = fs::metadata(&bin)?.len() / 2352;
    let data = fs::read(&bin)?;
    let ff = have("ffmpeg");
    for (i, &(num, start)) in tracks.iter().enumerate() {
        if num == 1 {
            continue; // data track
        }
        let end = tracks.get(i + 1).map_or(total, |t| t.1);
        let pcm = &data[(start * 2352) as usize..(end * 2352) as usize];
        let wav = out.join(format!("track{num:02}.wav"));
        let mut f = Vec::with_capacity(pcm.len() + 44);
        f.extend(b"RIFF");
        f.extend((36 + pcm.len() as u32).to_le_bytes());
        f.extend(b"WAVEfmt ");
        f.extend(16u32.to_le_bytes());
        f.extend(1u16.to_le_bytes());
        f.extend(2u16.to_le_bytes());
        f.extend(44100u32.to_le_bytes());
        f.extend((44100u32 * 4).to_le_bytes());
        f.extend(4u16.to_le_bytes());
        f.extend(16u16.to_le_bytes());
        f.extend(b"data");
        f.extend((pcm.len() as u32).to_le_bytes());
        f.extend(pcm);
        fs::write(&wav, f)?;
        if ff {
            let ogg = out.join(format!("track{num:02}.ogg"));
            let ok = Command::new("ffmpeg")
                .args(["-y", "-loglevel", "error", "-i"])
                .arg(&wav)
                .args(["-c:a", "libvorbis", "-q:a", "6"])
                .arg(&ogg)
                .status()?
                .success();
            if ok {
                fs::remove_file(&wav)?;
            }
        }
        println!("music track {num}: {:.0}s", pcm.len() as f64 / 176400.0);
    }
    Ok(())
}

/// Returns (track number, start sector of INDEX 01).
fn parse_cue(s: &str) -> Vec<(u32, u64)> {
    let mut out = Vec::new();
    let mut cur = 0;
    for l in s.lines().map(str::trim) {
        if let Some(r) = l.strip_prefix("TRACK ") {
            cur = r.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if let Some(r) = l.strip_prefix("INDEX 01 ") {
            let p: Vec<u64> = r.split(':').filter_map(|x| x.trim().parse().ok()).collect();
            if p.len() == 3 {
                out.push((cur, (p[0] * 60 + p[1]) * 75 + p[2]));
            }
        }
    }
    out
}
