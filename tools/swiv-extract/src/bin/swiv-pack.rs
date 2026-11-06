//! swiv-pack: convert the original game data into the web layout the remake loads at startup
//! (`web/assets/`), so the page needs no CD. Maps and textures become PNGs (see
//! `swiv_formats::pack`); everything else stays in small bundles.
//!
//! Usage: swiv-pack <GameData dir> <out dir, e.g. web/assets> [--music <dir of trackNN.mp3>]
//!                  [--anims <the CD's Anims dir>]
//!
//! With `--anims` (and ffmpeg on the PATH) the soundtrack of the two intro videos is written as
//! `intro.mp3`, which the real-time intro cinematic plays in sync, and each mission briefing
//! video's soundtrack as `briefing/BR_TERn.mp3` with its overlay script (`.SCR`), which the
//! rebuilt briefings play in sync. The briefing sound effects (grid, waypoint, close-up, outro
//! and the hum under them) are not in SOUNDS.BD, so they are also cut from BR_TER1's soundtrack
//! for the levels that have no briefing video.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use swiv_formats::{bundle::Bundle, level::{Level, NEUTRAL_SHADE}, pack, sounds};

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: swiv-pack <GameData dir> <out dir> [--music DIR] [--anims DIR]");
        std::process::exit(2);
    }
    let opt = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).map(PathBuf::from);
    if let Err(e) = run(Path::new(&args[1]), Path::new(&args[2]), opt("--music"), opt("--anims")) {
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

/// Frames in INTRO1.SMK at the Smacker rate of one frame per 71 ms: the second video starts
/// exactly this far in, both on screen and in `intro.mp3`.
const INTRO1_SECONDS: f64 = 315.0 * 0.071;

/// The file in `dir` called `name`, whatever its case on disk (the CD mixes INTRO1.SMK and Intro2.smk).
fn find_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.filter_map(|e| e.ok().map(|e| e.path())).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(name)))
}

/// The intro videos' soundtrack, INTRO1 padded to its picture length then Intro2, as MP3
/// (the source is 8-bit 22 kHz stereo; 96 kbit/s keeps it transparent at a quarter of the WAV's
/// size). Returns false when skipped.
fn intro_audio(anims: &Path, out: &Path) -> Res<bool> {
    let (Some(a), Some(b)) = (find_ci(anims, "INTRO1.SMK"), find_ci(anims, "INTRO2.SMK")) else {
        eprintln!("intro videos not found in {}: skipping intro audio", anims.display());
        return Ok(false);
    };
    let ok = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"]).arg(&a).arg("-i").arg(&b)
        .args(["-filter_complex", &format!("[0:a]apad,atrim=end={INTRO1_SECONDS}[a];[a][1:a]concat=n=2:v=0:a=1"), "-c:a", "libmp3lame", "-b:a", "96k"])
        .arg(out.join("intro.mp3"))
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        eprintln!("ffmpeg failed or missing: skipping intro audio");
    }
    Ok(ok)
}

/// Briefing videos and the levels they brief.
const BRIEFINGS: [(&str, &str); 8] = [
    ("BR_TER0", "TERRAN00"), ("BR_TER1", "TERRAN01"), ("BR_TER2", "TERRAN02"), ("BR_TER3", "TERRAN03"),
    ("BR_TER4", "TERRAN04"), ("BR_TER5", "TERRAN05"), ("BR_TER6", "TERRAN06"), ("BR_TERB", "TERRANBS"),
];

/// Sound effects cut from BR_TER1's soundtrack (start, end in seconds; `None` end = to the end):
/// the map spinning up and its grid drawing in, a waypoint's flash, a close-up appearing, the
/// close-ups leaving, and a seamless loop of the hum that runs under all of them.
const BRIEFING_CLIPS: [(&str, f64, Option<f64>); 4] = [
    ("grid", 0.0, Some(2.05)),
    ("waypoint", 2.1, Some(2.95)),
    ("screenshot", 3.22, Some(3.95)),
    ("outro", 22.3, None),
];
const BRIEFING_HUM: (f64, f64, f64) = (18.3, 22.2, 0.2); // loop start, end, crossfade

fn ffmpeg(args: &[&str]) -> bool {
    Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).status().map(|s| s.success()).unwrap_or(false)
}

/// Seconds per frame and duration of a video, from ffprobe.
fn video_timing(path: &Path) -> Option<(f64, f64)> {
    let o = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate:format=duration", "-of", "default=nw=1:nk=1"])
        .arg(path)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&o.stdout);
    let mut lines = text.lines();
    let (n, d) = lines.next()?.split_once('/')?;
    let fps = n.trim().parse::<f64>().ok()? / d.trim().parse::<f64>().ok()?;
    let duration = lines.next()?.trim().parse().ok()?;
    Some((1.0 / fps, duration))
}

/// A briefing overlay script: per line `group index first_frame last_frame x y font align`, a
/// GLOBAL.BD string shown over the video between two frames, at (x, y) in the video's 320x400
/// pixels (shown at 640x480), in font `b` (white) or `g` (grey), aligned `l`eft or `r`ight.
fn briefing_script(text: &str) -> String {
    let rows: Vec<String> = text
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            if f.len() < 8 || f[..6].iter().any(|v| v.parse::<i32>().is_err()) {
                return None;
            }
            Some(format!("[{}, \"{}\", \"{}\"]", f[..6].join(", "), f[6], f[7]))
        })
        .collect();
    format!("[{}]", rows.join(", "))
}

/// The briefing videos' soundtracks, scripts and sound effects. Returns the manifest's
/// `"briefings"` entry, or None when skipped.
fn briefing_audio(anims: &Path, out: &Path) -> Res<Option<String>> {
    let dir = out.join("briefing");
    fs::create_dir_all(&dir)?;
    let mut entries = Vec::new();
    for (video, level) in BRIEFINGS {
        let Some(smk) = find_ci(anims, &format!("{video}.SMK")) else { continue };
        let Some((frame, duration)) = video_timing(&smk) else {
            eprintln!("ffprobe failed or missing: skipping briefing audio");
            return Ok(None);
        };
        let file = format!("{video}.mp3");
        if !ffmpeg(&["-i", &smk.to_string_lossy(), "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", &dir.join(&file).to_string_lossy()]) {
            eprintln!("ffmpeg failed or missing: skipping briefing audio");
            return Ok(None);
        }
        let script = find_ci(anims, &format!("{video}.SCR")).and_then(|p| fs::read_to_string(p).ok()).map(|t| briefing_script(&t)).unwrap_or_else(|| "[]".into());
        entries.push(format!(
            "    \"{level}\": {{ \"audio\": \"briefing/{file}\", \"frame\": {frame:.6}, \"duration\": {duration:.3}, \"script\": {script} }}"
        ));
        if video == "BR_TER1" {
            let src = smk.to_string_lossy();
            for (name, from, to) in BRIEFING_CLIPS {
                let mut filter = format!("atrim=start={from}");
                if let Some(to) = to {
                    let _ = write!(filter, ":end={to}");
                }
                filter.push_str(",asetpts=PTS-STARTPTS,afade=t=in:d=0.01");
                if let Some(to) = to {
                    let _ = write!(filter, ",afade=t=out:st={}:d=0.08", to - from - 0.08);
                }
                ffmpeg(&["-i", &src, "-vn", "-ac", "1", "-ar", "22050", "-af", &filter, "-c:a", "pcm_s16le", &dir.join(format!("{name}.wav")).to_string_lossy()]);
            }
            // The hum as a seamless loop: its last `fade` seconds cross into the audio just
            // before the loop's start, so the end runs straight on into the beginning.
            let (a, b, fade) = BRIEFING_HUM;
            let filter = format!(
                "[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[x];[0:a]atrim=start={}:end={a},asetpts=PTS-STARTPTS[y];[x][y]acrossfade=d={fade}:c1=tri:c2=tri",
                a - fade
            );
            ffmpeg(&["-i", &src, "-vn", "-ac", "1", "-ar", "22050", "-filter_complex", &filter, "-c:a", "pcm_s16le", &dir.join("hum.wav").to_string_lossy()]);
        }
    }
    if entries.is_empty() {
        eprintln!("briefing videos not found in {}: skipping briefing audio", anims.display());
        return Ok(None);
    }
    let clips = BRIEFING_CLIPS.iter().map(|c| c.0).chain(["hum"]).filter(|n| dir.join(format!("{n}.wav")).exists());
    let clips: Vec<String> = clips.map(|n| format!("\"{n}\": \"briefing/{n}.wav\"")).collect();
    Ok(Some(format!("{{\n{},\n    \"sounds\": {{ {} }}\n  }}", entries.join(",\n"), clips.join(", "))))
}

fn run(data: &Path, out: &Path, music: Option<PathBuf>, anims: Option<PathBuf>) -> Res<()> {
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

    // Sound effects as WAV files named `<effect id>-<description>.wav`.
    let snd = fs::read(data.join("SOUNDS.BD"))?;
    fs::create_dir_all(out.join("sounds"))?;
    let mut effects = Vec::new();
    for s in sounds::split(&snd) {
        let name = sounds::file_name(s.effect);
        fs::write(out.join("sounds").join(&name), s.riff)?;
        effects.push(format!("\"{name}\""));
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
    let _ = write!(manifest, "  \"music\": [{}]", tracks.join(", "));
    if let Some(a) = anims {
        if intro_audio(&a, out)? {
            manifest.push_str(",\n  \"intro\": \"intro.mp3\"");
        }
        if let Some(b) = briefing_audio(&a, out)? {
            let _ = write!(manifest, ",\n  \"briefings\": {b}");
        }
    }
    manifest.push_str("\n}\n");
    fs::write(out.join("manifest.json"), manifest)?;
    println!("levels: {} ({:.1} MB), sounds: {}, music tracks: {}", levels.len(), bytes as f64 / 1e6, effects.len(), tracks.len());
    Ok(())
}
