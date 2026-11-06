# SWIV 3D (1996) data formats

Reverse-engineered from `swiv_win.exe` (Win95 build, 22 Oct 1996). The executable carries
Watcom WDI v3 debug info (trailer signature `0x8386`), which yields 1,543 named symbols
(the DOS build has 2,034). Names below (`LEVEL_initlevel`, `_LSCAPE_Hmap`, …) are the
original identifiers. Parsers live in `crates/swiv-formats`.

All integers are little-endian.

## BD container (`GLOBAL.BD`, `SOUNDS.BD`, `*.SLV`)

The directory is at the **end** of the file:

```
... resource data ...
entry[0..n-1]:  u32 offset, u32 size, u32 id
entry[n-1]:     u32 n,      u32 junk, u32 0        <- terminator; offset field = entry count
```

The last 12 bytes therefore give the count; the directory starts at `len - n*12`.
The game reads the whole file into memory and finds resources by id (`LEVEL_make_ref`).

## Levels (`*.SLV`)

Loaded by `LEVEL_initlevel`. World units: one map cell = `1 << 14`; the map is 512x512
cells and wraps (`& 0x1ff`).

| id    | symbol              | size     | contents |
|-------|---------------------|----------|----------|
| 100   | `_LSCAPE_Hmap`      | 512x512  | heights, u8. World height = `h << 10` |
| 102   | `_LSCAPE_Tmap`      | 512x512  | per-cell type (0 = water) |
| 103   | `_LSCAPE_Mmap`      | 512x512  | pre-shaded colour map, palette indices (this is the terrain image) |
| 104   | –                   | 1048     | level settings |
| 105   | `_start_objects`    | n x 64   | spawn list, see below |
| 106   | `_LEVEL_lowdet`     | 128x128  | low-detail map |
| 107   | `_nodetab`          |          | AI path nodes |
| 108   | `_GLOBAL_alphatab`  | 256x256  | blend table |
| 109   | `_GLOBAL_flametab`  | 32 KiB   | flame colours |
| 110   | `_LEVEL_shadowmap`  | 256x256  | |
| 500   | `_rotdat`           |          | rotor animation |
| 501   | `_wheeldat`         |          | wheel animation |
| 10xxx | `_raw_models[id%1000]` |       | 3D models |
| 11003 | `_system_pal`       | 0x2300   | 768-byte 6-bit VGA palette, then `_GLOBAL_trantab` (0x2000) |
| 11004 | `_LEVEL_debris`     |          | debris definitions |
| 12xxx | `_TEX_dat`/`_TEX_flt` | 0x18100 | texture page |

### Ground texture (`Tmap` + page 12000)

Page 12000 is twice as tall as the others: 256 x 512 texels forming a vertical strip of
ground materials, top to bottom water, sand, grass, soil, rock. `Tmap` picks the strip row
(`row = 2 * tmap`), and `Mmap` is that row's colour with lighting baked in (its brightness
over the row's average is the same in R, G and B), so the near ground is drawn from the strip
and lit by the colour map.

### Debris (`LEVEL_debris`, resource 11004)

What objects break into, per model. A linked list of nodes `{i32 next, i32 first_entry,
i32 key}` with `key = variant << 16 | model`; each node's entries form a ring
`{u32 data, i32 next, i32 model}` back to `first_entry` (offsets from the resource start;
`data` not decoded). Read against the footage, variant 0 is what stays behind (one is picked:
house 500 leaves rubble 712, 713 or 714; every tree one of the stumps 761..766), variant 1
the pieces thrown out on destruction (trees throw the leaf clumps 767..770), variant 2 chips
knocked off while it is being hit.

A building's second spawn model is the pickup hidden in it (collectable models as on the
pickup spawns: 800 Missiles, 801 Homing Missiles, 606 25% Health ...). 850 (MultiFire) is on
most buildings but never turns up in the footage, so the remake treats it as "nothing".

### Height lookup (`LSCAPE_GetMapH`)

```
cx = x >> 14, cz = z >> 14            (cell, wrapped & 0x1ff)
fx = (x >> 6) & 0xff, fz = (z >> 6) & 0xff
h(i,j) = Hmap[(cz+j)&511][(cx+i)&511] << 10
top = h00 + ((h10-h00)*fx >> 8); bot = h01 + ((h11-h01)*fx >> 8)
height = top + ((bot-top)*fz >> 8)
```

### Texture page (12000 + page)

```
+0x0000  256 bytes   name (NUL terminated, usually empty)
+0x0100  128 x 256   shade LUT: palette index = LUT[shade*256 + texel]
                     row 0 = black, ~64 = the texture's own colours, 127 = near white;
                     the distance cue fades towards row 0, so far terrain and sky are black
+0x8100  256 x 256   texels, 16 tiles of 64x64 (tile k at column (k&3)*64, row (k>>2)*64)
```

`load_tex` maps `page*16 + tile` into `TEX_dat[]`; a model face's `tex` field indexes that.

### Models (10000 + n)

```
+0x00 i32 vertex_count     +0x10 i32 y_min (lowest y; used to sit on the ground)
+0x04 i32 face_count       +0x14 i32 class-ish (30 craft/weapons, 40 scenery, 100 foliage)
+0x08 i32 normal_count     +0x18 u32 face offset    (relative; patched to a pointer on load)
+0x0C i32 size/collision   +0x1C u32 normal offset
+0x20 vertices: {i32 x, i32 y, i32 z, i32 part}      y is up, units x256 = world
faces (42 bytes): u32 v[3]; u32 n[3]; u32 tex; i16 u[3]; i16 v[3]; u16 flags
normals: {i32 x, i32 y, i32 z} scaled to length 100
```

Face flags seen: `0` plain, `4` palette index 0 is transparent (foliage, fences),
`5` billboard sprite, `1`/`2` special geometry (rotor discs; tex/uv hold other data),
`0x28` flat ground shadow (drawn dark on the terrain; tex/uv are not texture refs),
`0x200` two-sided. Texture `v` is negative: it counts up from the bottom row of the tile
(`row = 63 + v`), so `v = -63` is the top row.

Known model numbers: 990 player helicopter (`OBJECT_Heli1`), 991 buggy, 980 wheel,
767..770 explosion fireballs, 700..770 debris/props, 500..523 buildings, 560..565 trees,
600..609 pickups, 100..103 aircraft, 200..206 tanks and turret tops, 400..402 turrets.

### Spawn records (`_start_objects`, 64 bytes, ended by class -1)

```
i32 class, x, z, angle(512/turn), model, model2, params[10]
```

`x`/`z` are in 1/64 cell (world = value << 8). `params[0]` is hit points.
`params[1] = 5000 + g` registers the object in objective group `g`
(`GAME_register_objective`). The class is dispatched in `GAME_Setup`:

| class | behaviour |
|-------|-----------|
| 1000, 1001 | player start (base model) |
| 2000-2004 | static scenery (`OBJECT_pose3`), some with `OBJECT_radar_top` |
| 3000 | `OBJECT_turret1` on a `pose3` base |
| 3001 | `OBJECT_pillbox1` |
| 3002 | `OBJECT_turret_h1b` + `OBJECT_turret_h1t` |
| 3100 | `OBJECT_stank1` + top |
| 3200 | `OBJECT_boss3eye` |
| 4001/4002 | `OBJECT_air1` / `OBJECT_air2` |
| 4100/4101 | `OBJECT_drone1` (+gun) / `OBJECT_slugdrone` |
| 5000-5004 | `OBJECT_tank1`, `tank2`, APC with `apcwheel`s, trailers |
| 5010 | `OBJECT_gravtank1` + top |
| 5500 | `OBJECT_boat1`, `sub1` |
| 6000 | `OBJECT_spawn_tank1` |
| 6100-6110 | `OBJECT_spawn_plane1/11/2` + radar |
| 6200 | `OBJECT_carryall` |
| 6300 | `OBJECT_invspawn` |
| 7000-7002 | `OBJECT_pickup_std`, `pickup_conditional(1)` |
| 7010.. | vehicle changeovers, `OBJECT_teleport`, bosses |

## `GLOBAL.BD`

| id | contents |
|----|----------|
| 100 | UI strings (below) |
| 200 | `_GLOBAL_3dfont`: extruded polygon letters for the pickup names (below) |
| 501-512 | sprites / fonts (not yet decoded) |
| 600, 700 | menu tables |
| 800 | 64 KiB table |
| 1000-1003 | full-screen images: 768-byte palette + pixels (width not yet confirmed) |

### 3D font (resource 200)

256 records of 28 bytes, indexed by character code (lower case shares the upper-case shapes):
`i32 half_width, vertex_offset, vertex_count, face_offset, face_count, 0x7000, 23`. Offsets
are from the resource start (`GLOBAL_relocate_3dfont` turns them into pointers). Vertices are
`{i32 x, y, z}`, centred on x, about -91..108 tall and -38..38 deep; faces are
`{i32 v0, v1, v2, side}`. The pen advances `half_width` either side of each glyph; characters
without a shape (space) keep only the width.

### Strings (resource 100)

Header rows `{u16 group, u16 lang, u32 offset}` until `group == 0xFFFF`. Lang 0-7 =
English, Français, Deutsch, Español, Italiano, Polski, Čeština, Português; lang 99 = misc.
Each group is `{u32 index, u32 offset}` pairs until `index == 0xFFFFFFFF`, pointing at
NUL-terminated Latin-1 text; `|` is a line break.

## `SOUNDS.BD`

A BD container of RIFF WAVE files (8-bit mono, 11025 Hz). Directory id = `effect*100 +
priority`, where `effect` is what the code passes to `OS_SOUND_attach_effect`:

| effect | use |
|--------|-----|
| 1000-1003 | explosions (`OBFUNC_explode1..4`), crashes |
| 2000-2005 | `WEAPON_object_fire` |
| 3000-3002 | player specials |
| 4000, 4002 | pickups |
| 4001 | warning (`GAME_handler`) |
| 4010, 4011, 4020 | ground engine, specials |
| 5000-5002 | player engine loops (heli, buggy, ski) |
| 6000-6004 | landscape text, menus |

## CD audio

Tracks 2-10 of the mixed-mode CD are Red Book audio. The player picks the track in the menu
(`MENU_selmusic` → `_GLOBAL_tracks` → `CD_play`). `swiv-extract --cue` rips them; the web
build can also stream them directly from the `.bin` using the `.cue` sheet.

## Videos

`Anims/*.SMK` are Smacker videos (intro, briefings `BR_TERn`, endings); `*.SCR` are small
companion scripts. ffmpeg decodes them.

# Player flight model

`GAME_player_setup` gives the helicopter `CONTROL_keyboard_1H` (input) and
`OBJECT_Heli1` → `OBFUNC_heli_base(obj, 0x50)` (physics). Object fields:
`+0x1c/20/24` position, `+0x28/2c/30` velocity, `+0x34` yaw (512/turn), `+0x38` thrust,
`+0x3c` strafe, `+0x4c` model. Per frame:

```
control:   c = 0; turn keys: c0 ∓= 600, c2 ∓= 200; thrust keys: c1 ±= 1200;
           strafe keys (or modifier + turn): c2 ±= 800
           t0 += c0; t1 -= c1; t2 += c2
           yaw = t0 >> 8; thrust = t1 >> 8; strafe = t2 >> 7
           t1 = t1*14 >> 4; t2 = t2*14 >> 4            (t0 never decays)
gamelp:    pos += vel
heli_base: strafe -> 0 by 4, thrust -> 0 by 2
           vel.xz -= sin256/cos256(yaw) * thrust >> 5
           vel.xz += sin256/cos256(yaw+128) * strafe >> 6
           g = max(H(pos), H(pos + vel*32))
           err = (g >> 8) + 0x50 - (y >> 8);  vy += err>0 ? 2*err : err>>1
           vel -= vel >> 4 (or to 0 when that is 0)
           if y - 2000 <= H(pos): crash, bounce towards lowest of 16 probes
```

The logic runs once per rendered frame in the original (no fixed timestep); this port uses
a fixed 30 Hz tick (`swiv_core::TICK_HZ`). Resulting top speed ≈ 4,800 world units/tick.
