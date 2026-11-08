# SWIV 3D: Rust + WebAssembly + WebGL 2

[![Play](https://img.shields.io/badge/%E2%96%B6-Play%20in%20browser-brightgreen?style=for-the-badge)](https://bertyhell.github.io/swiv3d)

![The first level running in the browser: the helicopter over a river, with pylons, buildings, the targeting reticle, radar and score](docs/screenshot.jpg)

A browser version of **SWIV 3D** (SCi, 1996). The game itself (data loading, simulation and
3D rendering) is written in Rust and compiled to WebAssembly. A thin JavaScript layer
handles the page, menus, HUD, input and audio.

## Repository layout

| path | what |
|------|------|
| `Cargo.toml` | Cargo workspace for the Rust crates |
| `crates/swiv-formats` | parsers for the game's data: level bundles, heightmaps, colour maps, palettes, texture pages, 3D models, spawn lists, the 3D font, strings and sounds |
| `crates/swiv-core` | the game simulation: player flight, enemies, weapons, pickups, objectives. Pure Rust, no I/O |
| `crates/swiv-web` | the WebAssembly entry point (`Game`, exported with wasm-bindgen) and the WebGL 2 renderer |
| `web/index.html`, `web/style.css` | the page and HUD layout |
| `web/main.js` | boot, asset loading, the frame loop, input (keyboard and gamepad), HUD, radar, map and audio |
| `web/frontend.js` | the menus: pilots, controller, main menu, setup, credits |
| `web/briefing.js`, `web/globe.js` | the mission briefing screens |
| `web/cockpit.js`, `web/cockpit-shell.js` | the gunship cockpit, shared by the intro and the briefing: the controls, and the dashboard shapes they sit on |
| `web/intro.js` | the opening cinematic, rendered in real time with three.js (`web/vendor/`, MIT) |
| `web/assets/` | the game data the page loads at runtime, listed in `manifest.json` |
| `web/pkg/` | build output: the compiled `.wasm` and its JavaScript bindings |
| `build.sh` | builds `crates/swiv-web` to WebAssembly and generates `web/pkg/` |
| `run.sh` | serves `web/` locally with live reload |
| `.github/workflows/pages.yml` | builds the WebAssembly and deploys `web/` to GitHub Pages on every push to `main` |

## How it works

### Rust crates

The three crates are layered:

1. **`swiv-formats`** turns raw bytes into typed Rust structures, such as a `Level` (terrain
   maps, textures, models, spawns) or a `Font3d`. It has no dependency on the browser.
2. **`swiv-core`** holds the `World`, a deterministic simulation that advances in fixed
   30 Hz ticks (`TICK_HZ`). Each tick takes an `Input` (a bitmask of the pressed controls)
   and updates the helicopter, enemies, projectiles and objectives. It produces `Event`s
   (hits, pickups, objective done, level complete, and so on) and a list of `Instance`s to
   draw. Because it does no I/O and uses integer maths, the same inputs always give the same
   result, so it is easy to test natively with `cargo test`.
3. **`swiv-web`** wraps both crates for the browser. It is built as a `cdylib` for
   `wasm32-unknown-unknown` and uses `wasm-bindgen`, `web-sys` and `js-sys` to talk to
   JavaScript and WebGL.

### WebAssembly boundary

`build.sh` compiles `swiv-web` to `swiv_web.wasm`, and `wasm-bindgen --target web` generates
`web/pkg/swiv_web.js`, an ES module that loads the wasm and exposes the Rust API as
JavaScript classes. `web/main.js` imports it:

```js
import init, { Game, global_strings, sound_offsets } from './pkg/swiv_web.js';
await init();
const game = new Game(canvas);
```

The JavaScript side fetches the asset files and passes their bytes to Rust as
`Uint8Array`s (`load_font`, `load_level_parts`). From then on, each
`requestAnimationFrame` tick does the following:

- `game.update(dt_ms, key_bits)`: Rust collects the elapsed time and runs as many fixed
  simulation ticks as fit, so the game speed doesn't depend on the display's refresh rate.
- `game.render()`: draws the frame with WebGL.
- `game.hud()`, `game.radar()`, `game.take_events()`: return plain number arrays that
  JavaScript turns into HUD text, the radar, sound effects and music cues.

Only small numeric arrays cross the boundary each frame. The world state stays in wasm memory.

### WebGL 2 renderer

`crates/swiv-web/src/render.rs` creates a WebGL 2 context on the page's canvas (opaque, no
alpha). It uses GLSL ES 3.00 shaders embedded as Rust string constants, with one program
each for terrain, models, sprites, the 3D text and rotors.

- **Terrain** is a fixed grid of cells around the camera. The vertex shader looks up heights
  with `texelFetch` from an integer heightmap texture and wraps the coordinates, so the
  512×512 map tiles seamlessly. Per-cell type and baked lighting come from a second texture.
  The fragment shader samples the level's texture pages and fades to black with distance.
- **Models** (buildings, vehicles, the helicopter) are uploaded once per level into vertex
  array objects. Each frame they are drawn from the simulation's instance list.
- **Sprites** (shots, explosions, smoke, the lock-on ring) are camera-facing billboards
  blended over the scene.
- Everything is drawn relative to the camera, which keeps float precision high and makes
  the map's wraparound invisible.

The same `Game` also renders the menu background (a self-flying "attract" flight over a level)
and the menu headings in the game's 3D font.

## Build and run

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100
./build.sh
python3 -m http.server -d web 8080
```

Open <http://localhost:8080>, or use `./run.sh` for a live-reloading server.

Controls: the arrow keys turn and thrust, `W` `S` thrust, `A` `D` strafe, Space fires, Enter
fires the special weapon, `Q` `E` select a special weapon, `M` shows the map, `N` skips to the next music track, Esc pauses. All keys and gamepad buttons can be changed under Setup → Controller Setup (or Controls in the pause menu).
Gamepads work too.

## Tests

```bash
cargo test
```

The simulation tests check determinism over a scripted replay, the hover height and the top
speed.
