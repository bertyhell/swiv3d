# SWIV 3D — Rust + WebAssembly + WebGL 2

A browser rebuild of **SWIV 3D** (SCi, 1996) that runs on the original game data.
No copyrighted assets are included: the player points the page at their own copy of the CD.

The data formats and the player flight model were reverse-engineered from the original
executables, whose Watcom debug symbols survive (see [docs/formats.md](docs/formats.md)).
The earlier Unity fan remake (<https://github.com/bertyhell/swiv3d>) was used only as a
reference for feel; the original binaries are the source of truth.

## Layout

| path | what |
|------|------|
| `crates/swiv-formats` | parsers: BD/SLV bundles, heightmaps, colour maps, palettes, shade tables, texture pages, models, spawn lists, UI strings, sounds |
| `crates/swiv-core` | deterministic fixed-tick simulation; exact integer port of `CONTROL_keyboard_1H` + `OBFUNC_heli_base` |
| `crates/swiv-web` | wasm-bindgen entry point and WebGL 2 renderer |
| `tools/swiv-extract` | CLI that dumps everything to PNG / OBJ / WAV / JSON, rips CD audio, converts Smacker videos |
| `web/` | page, HUD, input, audio, file loading |
| `docs/formats.md` | byte-level format notes and the flight model |

## Play

Run these from this `remake/` folder:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100
./build-web.sh
cargo run --release -p swiv-extract --bin swiv-pack -- "../original/SWIV 3D (1996)/SWIV3D/cd/cd/GameData" web/assets --music ../mp3
python3 -m http.server -d web 8080
```

`swiv-pack` converts the game data once into `web/assets/`: every level's height, type and
colour maps and its texture pages as 8-bit PNGs (indexed with the game's own palette, so they
view correctly and keep the exact indices the renderer needs), a slim `level.bd` per level with
the models, spawns and tables, the sound effects as WAV and the soundtrack as MP3, listed in
`manifest.json`. Open <http://localhost:8080> and the menu comes up straight away.

Without `web/assets/` the page asks for the game instead: click **Choose game folder** and
select the CD's `GameData` folder (or the whole CD folder). For the soundtrack, include
`swiv3d.cue` + `swiv3d.bin` (streamed straight from the image) or a `music/` folder.

Controls: arrows turn / thrust, `W` `S` thrust, `A` `D` (or `Z` `X`) strafe,
Shift + arrows strafe, Space / Ctrl fire, Enter special weapon, `Q` `E` / Tab select special, `M` map,
`N` next music track, Esc pause. Gamepads work too.

## Extract assets

```bash
cargo run --release -p swiv-extract -- "<cd>/GameData" assets-out \
    --anims "<cd>/Anims" --cue "<path>/swiv3d.cue"
```

Produces per level `height.png`, `colour.png`, `type.png`, `palette.png`, texture pages,
every model as OBJ + MTL and `spawns.json`; plus `global/strings.json`, `sounds/<effect>.wav`,
`music/trackNN.ogg` and `video/*.webm`.

## Tests

```bash
SWIV_DATA="<cd>/GameData" cargo test
```

The data tests parse all 18 levels, `GLOBAL.BD` and `SOUNDS.BD`. The simulation tests check
determinism over a scripted replay, the hover height and the decoded top speed. Without
`SWIV_DATA` the data-dependent tests skip.

## Status

Done: every data format needed to play (terrain, textures, models, spawns, palette,
sounds, strings, CD audio, video), exact player flight physics, all 17 campaign levels
loadable in order, enemies (turrets, tanks, boats, aircraft, drones, spawners), pickups,
weapons with auto-targeting, objectives and level progression, HUD, radar, map, sound
effects, engine loop and CD music.

Approximated (not yet decompiled function by function): enemy AI tuning, weapon damage and
pickup effects, the buggy / ski vehicle changeovers, bosses' special patterns, menus and
briefing videos, weapon sprites (drawn as procedural glows until the GLOBAL.BD sprite banks
are decoded), wreck smoke and fire, and rotor discs.
