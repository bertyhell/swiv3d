//! WebGL 2 renderer.
//!
//! GL space: 1.0 = 256 world units (= one model unit), y up, world z mapped to -z so that
//! yaw grows clockwise when seen from above (the original's convention). Everything is drawn
//! relative to the camera so the 512-cell map can wrap seamlessly.

use glam::{Mat4, Vec3};
use swiv_core::world::{
    wrap, Instance, SPRITE_EXPLOSION, SPRITE_FIREBALL, SPRITE_IMPACT, SPRITE_MISSILE, SPRITE_PULSE, SPRITE_SMOKE, SPRITE_TARGET,
};
use swiv_formats::font3d::Font3d;
use swiv_formats::level::{Level, NEUTRAL_SHADE};
use swiv_formats::model::flags;
use wasm_bindgen::JsValue;
use web_sys::{WebGl2RenderingContext as GL, WebGlProgram, WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject};

/// Fraction of the view distance where the fade to black begins.
const FOG_START: f32 = 0.3;
/// Terrain grid radius in cells around the camera.
const TERRAIN_RADIUS: i32 = 80;
const ANGLE: f32 = std::f32::consts::TAU / 512.0;

const TERRAIN_VS: &str = r#"#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec2 a_grid;
uniform ivec2 u_origin;      // camera cell
uniform vec3 u_cam_frac;     // camera position inside its cell, GL units (x, y, -z)
uniform mat4 u_viewproj;
uniform highp usampler2D u_height;
uniform sampler2D u_cell;    // r = Tmap / 255, g = baked light / 4
out vec2 v_cell;
out vec3 v_world;            // (cell x, height in cells, cell y), for the grain projections
out vec3 v_normal;           // same axes as v_world
out float v_dist;
out float v_type;
out float v_light;
float height_at(ivec2 c) {
    return float(texelFetch(u_height, ivec2(c.x & 511, c.y & 511), 0).r) * 4.0;   // (h << 10) / 256
}
void main() {
    ivec2 c = u_origin + ivec2(a_grid);
    ivec2 w = ivec2(c.x & 511, c.y & 511);
    float h = height_at(c);
    vec3 p = vec3(a_grid.x * 64.0, h, -a_grid.y * 64.0) - u_cam_frac;
    vec4 cell = texelFetch(u_cell, w, 0);
    v_type = cell.r * 255.0;
    v_light = cell.g * 4.0;
    v_cell = vec2(c);
    // Central differences give a smooth per-vertex slope, so the projection blend has no
    // seams along triangle edges.
    float dx = (height_at(c + ivec2(1, 0)) - height_at(c - ivec2(1, 0))) / 128.0;
    float dy = (height_at(c + ivec2(0, 1)) - height_at(c - ivec2(0, 1))) / 128.0;
    v_normal = vec3(-dx, 1.0, -dy);
    v_world = vec3(vec2(c), h / 64.0).xzy;
    v_dist = length(p.xz);
    gl_Position = u_viewproj * vec4(p, 1.0);
}"#;

const TERRAIN_FS: &str = r#"#version 300 es
precision highp float;
in vec2 v_cell;
in vec3 v_world;
in vec3 v_normal;
in float v_dist;
in float v_type;
in float v_light;
uniform sampler2D u_colour;
uniform sampler2D u_ground;  // page 12000 strip: rgb = row average colour, a = texel / row brightness / 2
uniform bool u_has_ground;
uniform vec3 u_fog;
uniform vec2 u_fog_range;
uniform float u_time;
out vec4 o;
// The colour map is much brighter than the original renders it on screen.
const float TERRAIN_GAIN = 0.75;
// Ground grain texels per map cell (the strip repeats every 256 / GROUND_TEXELS cells).
const float GROUND_TEXELS = 32.0;
// Rows of the strip the grain is drawn from around the cell's own material.
const float GROUND_GRAIN_ROWS = 32.0;
// The grain is read at fixed rows this far apart and blended, never at the interpolated row
// itself: Tmap can jump by >100 between neighbouring cells, and sliding the lookup that far
// across one cell smears the grain along every material boundary.
const float GRAIN_ROW_STEP = 16.0;
// Grain brightness ratio for a projection plane position (in cells) of the material at `row`.
float grain_at(vec2 uv, float row) {
    const vec2 size = vec2(256.0, 512.0);
    vec2 p = vec2(uv.x, mod(uv.y, GROUND_GRAIN_ROWS / GROUND_TEXELS)) * GROUND_TEXELS;
    // Gradients from the continuous position, so the wrap above and the row steps below
    // don't drop to a tiny mip level and leave seam lines.
    vec2 gx = dFdx(uv) * GROUND_TEXELS / size;
    vec2 gy = dFdy(uv) * GROUND_TEXELS / size;
    float q = row / GRAIN_ROW_STEP;
    float r0 = floor(q) * GRAIN_ROW_STEP;
    float a = textureGrad(u_ground, (p + vec2(0.0, r0)) / size, gx, gy).a;
    float b = textureGrad(u_ground, (p + vec2(0.0, r0 + GRAIN_ROW_STEP)) / size, gx, gy).a;
    return mix(a, b, fract(q)) * 2.0;
}
void main() {
    vec4 c = texture(u_colour, (v_cell + 0.5) / 512.0);
    float water = c.a;
    vec3 col = c.rgb;
    if (u_has_ground) {
        // The Tmap value picks a row of the ground strip (water, sand, grass, soil, rock);
        // interpolating it across the cell blends neighbouring materials. The colour comes
        // from that row, the grain from a 2D patch of the strip around it (as a brightness
        // ratio, so it never shifts the colour), and the colour map's baked light goes on top.
        float row = v_type * 2.0 + 1.0;
        vec3 base = texture(u_ground, vec2(0.5, row / 512.0)).rgb;
        // Triplanar: projecting straight down smears the grain over steep slopes, so blend
        // the top projection with the two side ones by how much the surface faces each axis.
        vec3 wt = pow(abs(normalize(v_normal)), vec3(4.0));
        wt /= wt.x + wt.y + wt.z;
        float grain = wt.y * grain_at(v_world.xz, row)
                    + wt.x * grain_at(v_world.zy, row)
                    + wt.z * grain_at(v_world.xy, row);
        col = base * grain * v_light;
    }
    col *= TERRAIN_GAIN;
    if (water > 0.5) {
        float s = sin(v_cell.x * 1.7 + u_time * 2.1) * sin(v_cell.y * 1.3 - u_time * 1.6);
        col *= 0.93 + 0.12 * s;
    }
    float f = clamp((v_dist - u_fog_range.x) / (u_fog_range.y - u_fog_range.x), 0.0, 1.0);
    o = vec4(mix(col, u_fog, f), 1.0);
}"#;

const MODEL_VS: &str = r#"#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
layout(location=3) in float a_layer;
layout(location=4) in float a_flags;
uniform mat4 u_model;
uniform mat4 u_viewproj;
uniform highp usampler2D u_height;
uniform vec3 u_cam;          // camera position in GL units (x, y, -z), wrapped to the map
out vec2 v_uv;
out float v_layer;
out float v_light;
out float v_dist;
flat out int v_transparent;
flat out int v_shadow;
float ground(vec2 xz) {      // LSCAPE_GetMapH on the GPU, GL units relative to the camera
    vec2 c = vec2(xz.x + u_cam.x, -(xz.y + u_cam.z)) / 64.0;
    ivec2 i = ivec2(floor(c));
    vec2 f = c - vec2(i);
    float h00 = float(texelFetch(u_height, ivec2(i.x & 511, i.y & 511), 0).r);
    float h10 = float(texelFetch(u_height, ivec2((i.x + 1) & 511, i.y & 511), 0).r);
    float h01 = float(texelFetch(u_height, ivec2(i.x & 511, (i.y + 1) & 511), 0).r);
    float h11 = float(texelFetch(u_height, ivec2((i.x + 1) & 511, (i.y + 1) & 511), 0).r);
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y) * 4.0 - u_cam.y;
}
void main() {
    vec4 wp = u_model * vec4(a_pos, 1.0);
    v_shadow = a_flags > 2.5 ? 1 : 0;
    if (v_shadow == 1) {
        // Shadow faces sit flat under the model; drop them onto the terrain below and pull
        // them towards the camera so they win the depth test against the ground. Only the
        // corners follow the terrain, so a ridge under a large shadow bulges up through its
        // middle: the pull grows with the model's height above the ground (half of it),
        // which clears that for a hovering craft yet stays below its body. Moving along the
        // view ray only changes depth, never where the shadow lands on screen.
        vec4 origin = u_model * vec4(0.0, 0.0, 0.0, 1.0);
        float lift = origin.y - ground(origin.xz);
        wp.y = ground(wp.xz) + 0.5;
        wp.xyz -= normalize(wp.xyz) * clamp(lift * 0.5, 2.0, 48.0);
    }
    vec3 n = normalize(mat3(u_model) * a_normal);
    vec3 l = normalize(vec3(-0.4, 0.8, 0.45));
    v_light = 0.4 + 0.6 * max(dot(n, l), 0.0) + 0.1 * max(-dot(n, l), 0.0);
    v_uv = a_uv;
    v_layer = a_layer;
    v_dist = length(wp.xz);
    v_transparent = (a_flags > 0.5 && a_flags < 1.5) ? 1 : 0;
    gl_Position = u_viewproj * wp;
}"#;

const MODEL_FS: &str = r#"#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 v_uv;
in float v_layer;
in float v_light;
in float v_dist;
flat in int v_transparent;
flat in int v_shadow;
uniform sampler2DArray u_tex;
uniform vec3 u_fog;
uniform vec2 u_fog_range;
uniform float u_flash;
uniform float u_alpha;
uniform float u_char;        // 1 = burnt black (wrecks, stumps)
out vec4 o;
void main() {
    if (v_shadow == 1) {
        float f = clamp((v_dist - u_fog_range.x) / (u_fog_range.y - u_fog_range.x), 0.0, 1.0);
        o = vec4(0.0, 0.0, 0.0, 0.6 * (1.0 - f));
        return;
    }
    vec4 t = texture(u_tex, vec3(v_uv, v_layer));
    if (v_transparent == 1 && t.a < 0.5) discard;
    vec3 c = t.rgb * v_light;
    c = mix(c, c * vec3(0.32, 0.29, 0.27), u_char);
    c = mix(c, vec3(1.0, 0.95, 0.8), u_flash);
    float f = clamp((v_dist - u_fog_range.x) / (u_fog_range.y - u_fog_range.x), 0.0, 1.0);
    o = vec4(mix(c, u_fog, f), u_alpha);
}"#;

/// Camera-facing billboards: glows (energy pulses, fireballs, missiles), the lock-on ring and
/// tractor beams (a ribbon from `u_center` to `u_end`, `u_size` wide).
const SPRITE_VS: &str = r#"#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
uniform mat4 u_viewproj;
uniform vec3 u_center;
uniform vec3 u_end;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_size;
uniform int u_kind;          // 0 glow, 1 lock-on ring, 2 beam
out vec2 v_q;
void main() {
    v_q = a_corner;
    vec3 p;
    if (u_kind == 2) {
        vec3 a = mix(u_center, u_end, a_corner.x * 0.5 + 0.5);
        vec3 side = normalize(cross(u_end - u_center, a));
        p = a + side * a_corner.y * u_size;
    } else {
        p = u_center + (u_right * a_corner.x + u_up * a_corner.y) * u_size;
    }
    gl_Position = u_viewproj * vec4(p, 1.0);
}"#;

const SPRITE_FS: &str = r#"#version 300 es
precision highp float;
precision highp int;         // must match the vertex stage for the shared u_kind
in vec2 v_q;
uniform vec3 u_core;
uniform vec3 u_glow;
uniform int u_kind;
uniform float u_time;
uniform float u_seed;
out vec4 o;
const float PI = 3.14159265;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
    if (u_kind == 3) {
        // Fireball: billowing yellow core, orange body, ragged red edge.
        float r = length(v_q);
        vec2 q = v_q * 2.6 + vec2(u_seed * 13.1, u_seed * 7.3 - u_time * 1.5);
        float n = noise(q) * 0.6 + noise(q * 2.1 + 3.7) * 0.4;
        float edge = r + (n - 0.5) * 0.55;
        if (edge > 0.95) discard;
        float heat = clamp(1.0 - edge / 0.95, 0.0, 1.0);
        vec3 c = mix(vec3(0.55, 0.05, 0.0), vec3(1.0, 0.45, 0.05), smoothstep(0.0, 0.45, heat));
        c = mix(c, vec3(1.0, 0.92, 0.55), smoothstep(0.45, 0.9, heat));
        o = vec4(c * u_core.r, 1.0);
        return;
    }
    if (u_kind == 2) {
        float w = 1.0 - abs(v_q.y);
        o = vec4(u_glow * w * w + u_core * smoothstep(0.6, 1.0, w), 1.0);
        return;
    }
    float r = length(v_q);
    if (r > 1.0) discard;
    if (u_kind == 1) {
        // Four arcs on the diagonals with a short inward tick in the middle of each,
        // turning slowly.
        float a = atan(v_q.y, v_q.x) + u_time * 1.2;
        float m = mod(a + PI / 4.0, PI / 2.0) - PI / 4.0;   // 0 at the arc centres
        float arc = step(0.78, r) * step(r, 0.92) * step(abs(m), 0.5);
        float tick = step(0.6, r) * step(r, 0.8) * step(abs(m) * r, 0.05);
        float k = max(arc, tick);
        if (k < 0.5) discard;
        o = vec4(u_core, 0.95);
        return;
    }
    float core = smoothstep(0.35, 0.0, r);
    float glow = pow(1.0 - r, 1.5) * 1.3;
    o = vec4(u_core * core + u_glow * glow, 1.0);
}"#;

/// The 3D font (`_GLOBAL_3dfont`): flat-shaded red extruded letters, positioned in camera space.
const TEXT_VS: &str = r#"#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
uniform mat4 u_proj;
uniform mat4 u_model;        // camera space
out vec3 v_normal;
void main() {
    v_normal = mat3(u_model) * a_normal;
    gl_Position = u_proj * u_model * vec4(a_pos, 1.0);
}"#;

const TEXT_FS: &str = r#"#version 300 es
precision highp float;
in vec3 v_normal;
uniform float u_alpha;
out vec4 o;
void main() {
    vec3 n = normalize(gl_FrontFacing ? v_normal : -v_normal);
    float d = max(dot(n, normalize(vec3(-0.35, 0.45, 0.82))), 0.0);
    vec3 red = vec3(0.78, 0.05, 0.03);
    o = vec4(red * (0.28 + 0.8 * d), u_alpha);
}"#;

/// Rotors: a model's special (flag 1/2) triangles mark its rotor discs; each is drawn as a
/// two-bladed rotor turning with a motion-blurred trail, in the triangle's plane.
const ROTOR_VS: &str = r#"#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
uniform mat4 u_viewproj;
uniform mat4 u_model;
uniform vec3 u_center;
uniform vec3 u_axis_u;
uniform vec3 u_axis_v;
uniform float u_radius;
out vec2 v_q;
void main() {
    v_q = a_corner;
    vec3 p = u_center + (u_axis_u * a_corner.x + u_axis_v * a_corner.y) * u_radius;
    gl_Position = u_viewproj * u_model * vec4(p, 1.0);
}"#;

const ROTOR_FS: &str = r#"#version 300 es
precision highp float;
in vec2 v_q;
uniform float u_spin;
out vec4 o;
const float PI = 3.14159265;
void main() {
    float r = length(v_q);
    if (r > 1.0) discard;
    // Angle behind the nearest of the two blades: sharp leading edge, blurred trail.
    float behind = mod(atan(v_q.y, v_q.x) - u_spin, PI);
    // The blade has a real width (measured along the arc, so it doesn't taper to a point
    // at the centre), widening into a grip where it joins the hub.
    float chord = mix(0.2, 0.11, smoothstep(0.12, 0.34, r));
    float solid = step(behind * r, chord);
    float smear = exp(-(behind - chord / max(r, 1e-3)) * 2.2) * 0.55 * (1.0 - solid);
    float blade = max(solid * 0.92, smear) * smoothstep(1.0, 0.9, r);
    vec3 blade_col = vec3(0.07, 0.07, 0.08) + vec3(0.18) * solid * (1.0 - r);
    // Hub: a domed disc (lit towards the middle) with a dark seam around the centre cap.
    const float HUB = 0.14;
    float hub = smoothstep(HUB, HUB - 0.015, r);
    vec3 hub_col = vec3(0.1, 0.1, 0.11) + vec3(0.2) * smoothstep(HUB, 0.0, r);
    hub_col *= 1.0 - 0.55 * smoothstep(0.035, 0.045, r) * smoothstep(0.065, 0.055, r);
    hub_col *= 1.0 - 0.5 * smoothstep(HUB - 0.03, HUB - 0.01, r);
    float a = max(max(blade, 0.06), hub);
    o = vec4(mix(blade_col, hub_col, hub), a);
}"#;

/// One rotor disc in model space (GL axes).
#[derive(Clone, Copy)]
struct Rotor {
    center: Vec3,
    u: Vec3,
    v: Vec3,
    radius: f32,
    /// Turns per second (tail rotors spin faster).
    speed: f32,
}

/// Seconds a pickup name takes to fly across.
pub const TEXT_FLIGHT_SECS: f32 = 1.7;

struct ModelRange {
    first: i32,
    count: i32,
}

pub struct Renderer {
    gl: GL,
    terrain_prog: WebGlProgram,
    terrain_vao: WebGlVertexArrayObject,
    terrain_count: i32,
    model_prog: WebGlProgram,
    model_vao: Option<WebGlVertexArrayObject>,
    sprite_prog: WebGlProgram,
    sprite_vao: WebGlVertexArrayObject,
    text_prog: WebGlProgram,
    text_vao: Option<WebGlVertexArrayObject>,
    rotor_prog: WebGlProgram,
    rotors: std::collections::HashMap<i32, Vec<Rotor>>,
    /// Per character: (first vertex, vertex count) in the text buffer, and half width.
    glyphs: Vec<(i32, i32, i32)>,
    height_tex: Option<WebGlTexture>,
    colour_tex: Option<WebGlTexture>,
    cell_tex: Option<WebGlTexture>,
    ground_tex: Option<WebGlTexture>,
    model_tex: Option<WebGlTexture>,
    ranges: std::collections::HashMap<i32, ModelRange>,
    pub fog: [f32; 3],
    uniforms: std::collections::HashMap<&'static str, WebGlUniformLocation>,
}

fn compile(gl: &GL, vs: &str, fs: &str) -> Result<WebGlProgram, JsValue> {
    let mk = |kind, src: &str| -> Result<_, JsValue> {
        let s = gl.create_shader(kind).ok_or("create_shader")?;
        gl.shader_source(&s, src);
        gl.compile_shader(&s);
        if !gl.get_shader_parameter(&s, GL::COMPILE_STATUS).as_bool().unwrap_or(false) {
            return Err(gl.get_shader_info_log(&s).unwrap_or_default().into());
        }
        Ok(s)
    };
    let p = gl.create_program().ok_or("create_program")?;
    gl.attach_shader(&p, &mk(GL::VERTEX_SHADER, vs)?);
    gl.attach_shader(&p, &mk(GL::FRAGMENT_SHADER, fs)?);
    gl.link_program(&p);
    if !gl.get_program_parameter(&p, GL::LINK_STATUS).as_bool().unwrap_or(false) {
        return Err(gl.get_program_info_log(&p).unwrap_or_default().into());
    }
    Ok(p)
}

fn f32_view(gl: &GL, target: u32, data: &[f32]) {
    // SAFETY: the view is consumed by buffer_data before any allocation can move memory.
    unsafe {
        let view = js_sys::Float32Array::view(data);
        gl.buffer_data_with_array_buffer_view(target, &view, GL::STATIC_DRAW);
    }
}

pub struct Camera {
    pub pos: [i32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub fov: f32,
}

impl Renderer {
    pub fn new(gl: GL) -> Result<Self, JsValue> {
        let terrain_prog = compile(&gl, TERRAIN_VS, TERRAIN_FS)?;
        let model_prog = compile(&gl, MODEL_VS, MODEL_FS)?;
        let sprite_prog = compile(&gl, SPRITE_VS, SPRITE_FS)?;
        let text_prog = compile(&gl, TEXT_VS, TEXT_FS)?;
        let rotor_prog = compile(&gl, ROTOR_VS, ROTOR_FS)?;
        let sprite_vao = gl.create_vertex_array().ok_or("vao")?;
        gl.bind_vertex_array(Some(&sprite_vao));
        let sb = gl.create_buffer().ok_or("buffer")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&sb));
        f32_view(&gl, GL::ARRAY_BUFFER, &[-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]);
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, GL::FLOAT, false, 8, 0);
        gl.bind_vertex_array(None);
        // Terrain grid: (2R+1)^2 vertices, indexed triangles.
        let n = 2 * TERRAIN_RADIUS + 1;
        let mut verts = Vec::with_capacity((n * n * 2) as usize);
        for j in -TERRAIN_RADIUS..=TERRAIN_RADIUS {
            for i in -TERRAIN_RADIUS..=TERRAIN_RADIUS {
                verts.push(i as f32);
                verts.push(j as f32);
            }
        }
        let mut idx: Vec<u32> = Vec::new();
        for j in 0..n - 1 {
            for i in 0..n - 1 {
                let a = (j * n + i) as u32;
                let (b, c, d) = (a + 1, a + n as u32, a + n as u32 + 1);
                idx.extend_from_slice(&[a, c, b, b, c, d]);
            }
        }
        let vao = gl.create_vertex_array().ok_or("vao")?;
        gl.bind_vertex_array(Some(&vao));
        let vb = gl.create_buffer().ok_or("buffer")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&vb));
        f32_view(&gl, GL::ARRAY_BUFFER, &verts);
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, GL::FLOAT, false, 8, 0);
        let ib = gl.create_buffer().ok_or("buffer")?;
        gl.bind_buffer(GL::ELEMENT_ARRAY_BUFFER, Some(&ib));
        unsafe {
            let view = js_sys::Uint32Array::view(&idx);
            gl.buffer_data_with_array_buffer_view(GL::ELEMENT_ARRAY_BUFFER, &view, GL::STATIC_DRAW);
        }
        gl.bind_vertex_array(None);
        let mut r = Renderer {
            gl,
            terrain_prog,
            terrain_vao: vao,
            terrain_count: idx.len() as i32,
            model_prog,
            model_vao: None,
            sprite_prog,
            sprite_vao,
            text_prog,
            text_vao: None,
            rotor_prog,
            rotors: Default::default(),
            glyphs: Vec::new(),
            height_tex: None,
            colour_tex: None,
            cell_tex: None,
            ground_tex: None,
            model_tex: None,
            ranges: Default::default(),
            fog: [0.0; 3],
            uniforms: Default::default(),
        };
        for (prog, names) in [
            (0, &["u_origin", "u_cam_frac", "u_viewproj", "u_height", "u_colour", "u_fog", "u_fog_range", "u_time", "u_cell", "u_ground", "u_has_ground"][..]),
            (1, &["u_model", "u_viewproj", "u_tex", "u_fog", "u_fog_range", "u_flash", "u_alpha", "u_height", "u_cam", "u_char"][..]),
            (2, &["u_viewproj", "u_center", "u_end", "u_right", "u_up", "u_size", "u_core", "u_glow", "u_kind", "u_time", "u_seed"][..]),
            (4, &["u_viewproj", "u_model", "u_center", "u_axis_u", "u_axis_v", "u_radius", "u_spin"][..]),
            (3, &["u_proj", "u_model", "u_alpha"][..]),
        ] {
            for &name in names {
                let p = [&r.terrain_prog, &r.model_prog, &r.sprite_prog, &r.text_prog, &r.rotor_prog][prog];
                if let Some(loc) = r.gl.get_uniform_location(p, name) {
                    let key = match prog {
                        0 => tname(name),
                        2 => sname(name),
                        3 => xname(name),
                        4 => rname(name),
                        _ => name,
                    };
                    r.uniforms.insert(key, loc);
                }
            }
        }
        Ok(r)
    }

    fn u(&self, name: &str) -> Option<&WebGlUniformLocation> {
        self.uniforms.get(name)
    }

    /// Upload the 3D font as flat-shaded triangles (one face normal per triangle).
    pub fn load_font(&mut self, font: &Font3d) -> Result<(), JsValue> {
        let gl = &self.gl;
        let mut buf: Vec<f32> = Vec::new();
        self.glyphs.clear();
        for g in &font.glyphs {
            let first = (buf.len() / 6) as i32;
            for f in &g.faces {
                let p = f.map(|i| Vec3::from(g.vertices[i as usize].map(|c| c as f32)));
                let n = (p[1] - p[0]).cross(p[2] - p[0]).normalize_or_zero();
                for v in p {
                    buf.extend_from_slice(&[v.x, v.y, v.z, n.x, n.y, n.z]);
                }
            }
            self.glyphs.push((first, (buf.len() / 6) as i32 - first, g.half_width.max(0)));
        }
        let vao = gl.create_vertex_array().ok_or("vao")?;
        gl.bind_vertex_array(Some(&vao));
        let vb = gl.create_buffer().ok_or("buffer")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&vb));
        f32_view(gl, GL::ARRAY_BUFFER, &buf);
        for (loc, off) in [(0, 0), (1, 12)] {
            gl.enable_vertex_attrib_array(loc);
            gl.vertex_attrib_pointer_with_i32(loc, 3, GL::FLOAT, false, 24, off);
        }
        gl.bind_vertex_array(None);
        self.text_vao = Some(vao);
        Ok(())
    }

    /// Pickup names in flight: each enters from the right turned away from the camera,
    /// swings round to face it while sliding left and up, and leaves past the top left
    /// (`t` runs 0..1 over [`TEXT_FLIGHT_SECS`]), drawn over the scene.
    fn draw_texts(&self, proj: &Mat4, aspect: f32, fov: f32, texts: &[(String, f32)]) {
        let Some(vao) = &self.text_vao else { return };
        if texts.is_empty() {
            return;
        }
        const GAP: f32 = 24.0;
        const DEPTH: f32 = 400.0;
        let gl = &self.gl;
        gl.use_program(Some(&self.text_prog));
        gl.bind_vertex_array(Some(vao));
        gl.uniform_matrix4fv_with_f32_array(self.u("x_proj"), false, &proj.to_cols_array());
        gl.clear(GL::DEPTH_BUFFER_BIT);
        gl.enable(GL::DEPTH_TEST);
        gl.enable(GL::BLEND);
        gl.blend_func(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA);
        let half_h = DEPTH * (fov / 2.0).tan();
        let half_w = half_h * aspect;
        let glyph = |c: char| self.glyphs.get(c as usize).copied().unwrap_or((0, 0, 45));
        for (text, t) in texts {
            let width: f32 = text.chars().map(|c| glyph(c).2 as f32 * 2.0 + GAP).sum::<f32>() - GAP;
            let scale = 0.95 * half_w / width.max(1.0);
            let lerp = |a: f32, b: f32| a + (b - a) * t;
            let at = Mat4::from_translation(Vec3::new(lerp(1.15, -1.25) * half_w, lerp(-0.1, 0.5) * half_h, -DEPTH))
                * Mat4::from_rotation_y(lerp(-1.15, 0.8))
                * Mat4::from_scale(Vec3::splat(scale));
            let alpha = ((1.0 - t) * 8.0).min(1.0);
            gl.uniform1f(self.u("x_alpha"), alpha);
            let mut pen = -width / 2.0;
            for c in text.chars() {
                let (first, count, half) = glyph(c);
                pen += half as f32;
                if count > 0 {
                    let m = at * Mat4::from_translation(Vec3::new(pen, 0.0, 0.0));
                    gl.uniform_matrix4fv_with_f32_array(self.u("x_model"), false, &m.to_cols_array());
                    gl.draw_arrays(GL::TRIANGLES, first, count);
                }
                pen += half as f32 + GAP;
            }
        }
        gl.disable(GL::BLEND);
        gl.bind_vertex_array(None);
    }

    pub fn load_level(&mut self, level: &Level) -> Result<(), JsValue> {
        let gl = &self.gl;
        // Heightmap as R8UI for exact texelFetch.
        let ht = gl.create_texture().ok_or("tex")?;
        gl.bind_texture(GL::TEXTURE_2D, Some(&ht));
        gl.pixel_storei(GL::UNPACK_ALIGNMENT, 1);
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            GL::TEXTURE_2D, 0, GL::R8UI as i32, 512, 512, 0, GL::RED_INTEGER, GL::UNSIGNED_BYTE, Some(&level.hmap),
        )?;
        for p in [GL::TEXTURE_MIN_FILTER, GL::TEXTURE_MAG_FILTER] {
            gl.tex_parameteri(GL::TEXTURE_2D, p, GL::NEAREST as i32);
        }
        // Colour map (alpha marks water cells from the type map).
        let mut rgba = Vec::with_capacity(512 * 512 * 4);
        for (k, &c) in level.mmap.iter().enumerate() {
            let p = level.palette[c as usize];
            rgba.extend_from_slice(&[p[0], p[1], p[2], if level.tmap[k] == 0 { 255 } else { 0 }]);
        }
        let ct = gl.create_texture().ok_or("tex")?;
        gl.bind_texture(GL::TEXTURE_2D, Some(&ct));
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            GL::TEXTURE_2D, 0, GL::RGBA as i32, 512, 512, 0, GL::RGBA, GL::UNSIGNED_BYTE, Some(&rgba),
        )?;
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, GL::LINEAR as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::LINEAR as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_S, GL::REPEAT as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_T, GL::REPEAT as i32);

        // Ground detail: page 12000 is a 256 x 512 strip, two rows per Tmap value. Each cell of
        // the colour map is that strip's row shaded by baked lighting, so the light is
        // recovered as colour-map brightness over the row's average brightness.
        self.ground_tex = None;
        self.cell_tex = None;
        if let Some(page) = level.textures.iter().find(|t| t.id == 12000 && t.height() >= 512) {
            let texels = page.rgba(&level.palette, NEUTRAL_SHADE);
            let lum = |c: &[u8]| 0.3 * c[0] as f32 + 0.59 * c[1] as f32 + 0.11 * c[2] as f32;
            let row_lum: Vec<f32> = (0..256)
                .map(|t| texels[t * 2 * 1024..(t * 2 + 2) * 1024].chunks(4).map(lum).sum::<f32>() / 512.0)
                .collect();
            // rgb: each row's average colour; a: each texel's brightness relative to its row.
            let mut strip = Vec::with_capacity(texels.len());
            for row in texels.chunks(1024) {
                let mut avg = [0f32; 3];
                for c in row.chunks(4) {
                    for k in 0..3 {
                        avg[k] += c[k] as f32 / 256.0;
                    }
                }
                let avg_lum = lum(&avg.map(|v| v as u8)).max(1.0);
                for c in row.chunks(4) {
                    let ratio = lum(c) / avg_lum;
                    strip.extend_from_slice(&[avg[0] as u8, avg[1] as u8, avg[2] as u8, (ratio * 128.0).round().clamp(0.0, 255.0) as u8]);
                }
            }
            let mut cells = Vec::with_capacity(512 * 512 * 4);
            for (&t, &m) in level.tmap.iter().zip(&level.mmap) {
                let light = lum(&level.palette[m as usize]) / row_lum[t as usize].max(1.0);
                cells.extend_from_slice(&[t, (light * 64.0).round().clamp(0.0, 255.0) as u8, 0, 255]);
            }
            let cell = gl.create_texture().ok_or("tex")?;
            gl.bind_texture(GL::TEXTURE_2D, Some(&cell));
            gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
                GL::TEXTURE_2D, 0, GL::RGBA as i32, 512, 512, 0, GL::RGBA, GL::UNSIGNED_BYTE, Some(&cells),
            )?;
            for p in [GL::TEXTURE_MIN_FILTER, GL::TEXTURE_MAG_FILTER] {
                gl.tex_parameteri(GL::TEXTURE_2D, p, GL::NEAREST as i32);
            }
            let ground = gl.create_texture().ok_or("tex")?;
            gl.bind_texture(GL::TEXTURE_2D, Some(&ground));
            gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
                GL::TEXTURE_2D, 0, GL::RGBA as i32, 256, 512, 0, GL::RGBA, GL::UNSIGNED_BYTE, Some(&strip),
            )?;
            gl.generate_mipmap(GL::TEXTURE_2D);
            gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, GL::LINEAR_MIPMAP_LINEAR as i32);
            gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::NEAREST as i32);
            gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_S, GL::REPEAT as i32);
            gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_T, GL::CLAMP_TO_EDGE as i32);
            self.cell_tex = Some(cell);
            self.ground_tex = Some(ground);
        }

        // Distance cue fades down the shade LUT towards row 0 (black on every level), as in
        // the original where far terrain and the sky are black.
        if let Some(t) = level.textures.first() {
            let row = &t.shade[0..256];
            let mut acc = [0u32; 3];
            for &i in row {
                for k in 0..3 {
                    acc[k] += level.palette[i as usize][k] as u32;
                }
            }
            self.fog = acc.map(|v| v as f32 / 256.0 / 255.0);
        }

        // Texture pages -> 2D array, layer = page index (texture id - 12000).
        let pages = level.textures.iter().map(|t| t.id - 12000 + 1).max().unwrap_or(1) as i32;
        let mut layers = vec![0u8; (pages * 256 * 256 * 4) as usize];
        for t in &level.textures {
            let off = ((t.id - 12000) * 256 * 256 * 4) as usize;
            layers[off..off + 256 * 256 * 4].copy_from_slice(&t.rgba(&level.palette, NEUTRAL_SHADE)[..256 * 256 * 4]);
        }
        let mt = gl.create_texture().ok_or("tex")?;
        gl.bind_texture(GL::TEXTURE_2D_ARRAY, Some(&mt));
        gl.tex_image_3d_with_opt_u8_array(
            GL::TEXTURE_2D_ARRAY, 0, GL::RGBA as i32, 256, 256, pages, 0, GL::RGBA, GL::UNSIGNED_BYTE, Some(&layers),
        )?;
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_MIN_FILTER, GL::NEAREST as i32);
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_MAG_FILTER, GL::NEAREST as i32);
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_WRAP_S, GL::REPEAT as i32);
        gl.tex_parameteri(GL::TEXTURE_2D_ARRAY, GL::TEXTURE_WRAP_T, GL::REPEAT as i32);

        // All models in one buffer: pos3 normal3 uv2 layer1 flags1.
        let mut buf: Vec<f32> = Vec::new();
        self.ranges.clear();
        self.rotors.clear();
        for (&id, m) in &level.models {
            let first = (buf.len() / 10) as i32;
            for f in m.valid_faces().filter(|f| f.is_special() && !f.is_sprite()) {
                let p = f.v.map(|i| {
                    let c = m.vertices[i as usize].pos;
                    Vec3::new(c[0] as f32, c[1] as f32, -(c[2] as f32))
                });
                let center = (p[0] + p[1] + p[2]) / 3.0;
                let n = (p[1] - p[0]).cross(p[2] - p[0]).normalize_or_zero();
                let u = (p[0] - center).normalize_or_zero();
                let radius = p.iter().map(|q| q.distance(center)).fold(0.0, f32::max);
                if n == Vec3::ZERO || radius < 1.0 {
                    continue;
                }
                let speed = if radius < 20.0 { 7.0 } else { 3.2 };
                self.rotors.entry(id as i32 - 10000).or_default().push(Rotor { center, u, v: n.cross(u), radius: radius * 0.8, speed });
            }
            for f in m.valid_faces() {
                // 0x28 faces are the flat ground shadow; their tex/uv are not texture refs.
                let shadow = f.flags & flags::SHADOW == flags::SHADOW;
                if f.is_sprite() || f.is_special() || (!shadow && f.page() as i32 >= pages) {
                    continue;
                }
                let p = f.v.map(|i| m.vertices[i as usize].pos.map(|c| c as f32));
                let fnorm = {
                    let a = Vec3::from(p[1]) - Vec3::from(p[0]);
                    let b = Vec3::from(p[2]) - Vec3::from(p[0]);
                    a.cross(b).normalize_or_zero()
                };
                let (tx, ty) = (((f.tile() % 4) * 64) as f32, ((f.tile() / 4) * 64) as f32);
                let kind = if shadow { 3.0 } else if f.flags & flags::TRANSPARENT != 0 { 1.0 } else { 0.0 };
                for j in 0..3 {
                    let n = m
                        .normals
                        .get(f.n[j] as usize)
                        .map(|n| Vec3::new(n[0] as f32, n[1] as f32, n[2] as f32).normalize_or_zero())
                        .unwrap_or(fnorm);
                    // Model space -> GL space (z flipped).
                    buf.extend_from_slice(&[p[j][0], p[j][1], -p[j][2], n.x, n.y, -n.z]);
                    // v counts up from the bottom row of the tile (0 = row 63, -63 = row 0).
                    buf.push((tx + f.uv[j][0] as f32 + 0.5) / 256.0);
                    buf.push((ty + 63.0 + f.uv[j][1] as f32 + 0.5) / 256.0);
                    buf.push(if shadow { 0.0 } else { f.page() as f32 });
                    buf.push(kind);
                }
            }
            let count = (buf.len() / 10) as i32 - first;
            if count > 0 {
                self.ranges.insert(id as i32 - 10000, ModelRange { first, count });
            }
        }
        let vao = gl.create_vertex_array().ok_or("vao")?;
        gl.bind_vertex_array(Some(&vao));
        let vb = gl.create_buffer().ok_or("buffer")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&vb));
        f32_view(gl, GL::ARRAY_BUFFER, &buf);
        for (loc, size, off) in [(0, 3, 0), (1, 3, 12), (2, 2, 24), (3, 1, 32), (4, 1, 36)] {
            gl.enable_vertex_attrib_array(loc);
            gl.vertex_attrib_pointer_with_i32(loc, size, GL::FLOAT, false, 40, off);
        }
        gl.bind_vertex_array(None);
        self.height_tex = Some(ht);
        self.colour_tex = Some(ct);
        self.model_tex = Some(mt);
        self.model_vao = Some(vao);
        Ok(())
    }


    #[allow(clippy::too_many_arguments)]
    pub fn render(&self, w: i32, h: i32, cam: &Camera, instances: &[Instance], beams: &[([i32; 3], [i32; 3])], texts: &[(String, f32)], time: f32, fog_far: f32) {
        let gl = &self.gl;
        gl.viewport(0, 0, w, h);
        gl.clear_color(self.fog[0], self.fog[1], self.fog[2], 1.0);
        gl.clear(GL::COLOR_BUFFER_BIT | GL::DEPTH_BUFFER_BIT);
        let Some(model_vao) = &self.model_vao else { return };
        gl.enable(GL::DEPTH_TEST);
        gl.disable(GL::CULL_FACE);

        let aspect = w as f32 / h.max(1) as f32;
        let proj = Mat4::perspective_rh_gl(cam.fov, aspect, 4.0, fog_far * 1.05);
        let yaw = cam.yaw * ANGLE;
        // Camera looks along (sin yaw, cos yaw) in world = (sin, -cos) in GL.
        let fwd = Vec3::new(yaw.sin() * cam.pitch.cos(), -cam.pitch.sin(), -yaw.cos() * cam.pitch.cos());
        let view = Mat4::look_to_rh(Vec3::ZERO, fwd, Vec3::Y);
        let vp = proj * view;
        let fog_range = [fog_far * FOG_START, fog_far];

        // Terrain.
        let cell = [cam.pos[0] >> 14, cam.pos[2] >> 14];
        let frac = [
            (cam.pos[0] - (cell[0] << 14)) as f32 / 256.0,
            cam.pos[1] as f32 / 256.0,
            -((cam.pos[2] - (cell[1] << 14)) as f32 / 256.0),
        ];
        gl.use_program(Some(&self.terrain_prog));
        gl.uniform2i(self.u("t_origin"), cell[0], cell[1]);
        gl.uniform3f(self.u("t_cam_frac"), frac[0], frac[1], frac[2]);
        gl.uniform_matrix4fv_with_f32_array(self.u("t_viewproj"), false, &vp.to_cols_array());
        gl.uniform3f(self.u("t_fog"), self.fog[0], self.fog[1], self.fog[2]);
        gl.uniform2f(self.u("t_fog_range"), fog_range[0], fog_range[1]);
        gl.uniform1f(self.u("t_time"), time);
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, self.height_tex.as_ref());
        gl.uniform1i(self.u("t_height"), 0);
        gl.active_texture(GL::TEXTURE1);
        gl.bind_texture(GL::TEXTURE_2D, self.colour_tex.as_ref());
        gl.uniform1i(self.u("t_colour"), 1);
        gl.active_texture(GL::TEXTURE3);
        gl.bind_texture(GL::TEXTURE_2D, self.cell_tex.as_ref());
        gl.uniform1i(self.u("t_cell"), 3);
        gl.active_texture(GL::TEXTURE4);
        gl.bind_texture(GL::TEXTURE_2D, self.ground_tex.as_ref());
        gl.uniform1i(self.u("t_ground"), 4);
        gl.uniform1i(self.u("t_has_ground"), self.ground_tex.is_some() as i32);
        gl.bind_vertex_array(Some(&self.terrain_vao));
        gl.draw_elements_with_i32(GL::TRIANGLES, self.terrain_count, GL::UNSIGNED_INT, 0);

        // Models.
        gl.use_program(Some(&self.model_prog));
        gl.uniform_matrix4fv_with_f32_array(self.u("u_viewproj"), false, &vp.to_cols_array());
        gl.uniform3f(self.u("u_fog"), self.fog[0], self.fog[1], self.fog[2]);
        gl.uniform2f(self.u("u_fog_range"), fog_range[0], fog_range[1]);
        gl.uniform1f(self.u("u_alpha"), 1.0);
        gl.active_texture(GL::TEXTURE2);
        gl.bind_texture(GL::TEXTURE_2D_ARRAY, self.model_tex.as_ref());
        gl.uniform1i(self.u("u_tex"), 2);
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, self.height_tex.as_ref());
        gl.uniform1i(self.u("u_height"), 0);
        let wrap_gl = |c: i32| c.rem_euclid(swiv_core::world::WORLD_SIZE) as f32 / 256.0;
        gl.uniform3f(self.u("u_cam"), wrap_gl(cam.pos[0]), cam.pos[1] as f32 / 256.0, -wrap_gl(cam.pos[2]));
        gl.enable(GL::BLEND);
        gl.blend_func(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA);
        gl.bind_vertex_array(Some(model_vao));
        let far2 = (fog_far * 1.1).powi(2);
        let cull = fwd;
        let rel = |inst: &Instance| {
            Vec3::new(
                wrap(inst.pos[0] - cam.pos[0]) as f32 / 256.0,
                (inst.pos[1] - cam.pos[1]) as f32 / 256.0,
                -(wrap(inst.pos[2] - cam.pos[2]) as f32 / 256.0),
            )
        };
        let mut spinning = Vec::new();
        for inst in instances {
            let range = self.ranges.get(&inst.model);
            let rotors = self.rotors.get(&inst.model);
            if range.is_none() && rotors.is_none() {
                continue;
            }
            let d = rel(inst);
            if d.x * d.x + d.z * d.z > far2 {
                continue;
            }
            if d.dot(cull) < -200.0 {
                continue;
            }
            let s = inst.scale as f32 / 256.0;
            // Yaw rotates model +z (GL -z) towards +x: a negative rotation about GL y.
            let m = Mat4::from_translation(d)
                * Mat4::from_rotation_y(-(inst.yaw as f32) * ANGLE)
                * Mat4::from_rotation_x(-(inst.pitch as f32) * ANGLE)
                * Mat4::from_rotation_z(-(inst.roll as f32) * ANGLE)
                * Mat4::from_scale(Vec3::new(s, s * inst.squash as f32 / 256.0, s));
            gl.uniform_matrix4fv_with_f32_array(self.u("u_model"), false, &m.to_cols_array());
            gl.uniform1f(self.u("u_flash"), if inst.flash { 0.6 } else { 0.0 });
            gl.uniform1f(self.u("u_char"), if inst.charred { 1.0 } else { 0.0 });
            if let Some(r) = range {
                gl.draw_arrays(GL::TRIANGLES, r.first, r.count);
            }
            if let Some(rs) = rotors {
                // Phase from the instance position so neighbouring craft are out of step.
                let phase = ((inst.pos[0] ^ inst.pos[2]) & 0xffff) as f32 / 4096.0;
                spinning.extend(rs.iter().map(|r| (m, *r, phase)));
            }
        }

        // Rotors: blended over the craft, depth-tested but not written.
        if !spinning.is_empty() {
            gl.use_program(Some(&self.rotor_prog));
            gl.uniform_matrix4fv_with_f32_array(self.u("r_viewproj"), false, &vp.to_cols_array());
            gl.enable(GL::BLEND);
            gl.blend_func(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA);
            gl.depth_mask(false);
            gl.bind_vertex_array(Some(&self.sprite_vao));
            for (m, r, phase) in &spinning {
                gl.uniform_matrix4fv_with_f32_array(self.u("r_model"), false, &m.to_cols_array());
                gl.uniform3f(self.u("r_center"), r.center.x, r.center.y, r.center.z);
                gl.uniform3f(self.u("r_axis_u"), r.u.x, r.u.y, r.u.z);
                gl.uniform3f(self.u("r_axis_v"), r.v.x, r.v.y, r.v.z);
                gl.uniform1f(self.u("r_radius"), r.radius);
                gl.uniform1f(self.u("r_spin"), (time * r.speed + phase) * std::f32::consts::TAU);
                gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
            }
            gl.depth_mask(true);
        }

        // Glow sprites and beams: additive, depth-tested but not written.
        gl.use_program(Some(&self.sprite_prog));
        gl.uniform_matrix4fv_with_f32_array(self.u("s_viewproj"), false, &vp.to_cols_array());
        let right = fwd.cross(Vec3::Y).normalize();
        let up = right.cross(fwd);
        gl.uniform3f(self.u("s_right"), right.x, right.y, right.z);
        gl.uniform3f(self.u("s_up"), up.x, up.y, up.z);
        gl.uniform1f(self.u("s_time"), time);
        gl.blend_func(GL::ONE, GL::ONE);
        gl.depth_mask(false);
        gl.bind_vertex_array(Some(&self.sprite_vao));
        let rel_pos = |p: [i32; 3]| {
            Vec3::new(wrap(p[0] - cam.pos[0]) as f32 / 256.0, (p[1] - cam.pos[1]) as f32 / 256.0, -(wrap(p[2] - cam.pos[2]) as f32 / 256.0))
        };
        gl.uniform1i(self.u("s_kind"), 2);
        gl.uniform3f(self.u("s_core"), 1.0, 0.55, 0.45);
        gl.uniform3f(self.u("s_glow"), 0.9, 0.05, 0.02);
        gl.uniform1f(self.u("s_size"), 1.2);
        // The hoist: a yellow arm lowered from the craft with a red grab at its end, the beam
        // running from there down to the collectable.
        let hoist: Vec<(Vec3, Vec3)> = beams
            .iter()
            .map(|&(a, b)| {
                let (a, b) = (rel_pos(a), rel_pos(b));
                (a, b + (a - b).normalize_or_zero() * 14.0)
            })
            .collect();
        for &(a, grab) in &hoist {
            gl.uniform3f(self.u("s_center"), a.x, a.y, a.z);
            gl.uniform3f(self.u("s_end"), grab.x, grab.y, grab.z);
            gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
        }
        gl.uniform3f(self.u("s_core"), 1.0, 0.9, 0.3);
        gl.uniform3f(self.u("s_glow"), 0.75, 0.55, 0.0);
        gl.uniform1f(self.u("s_size"), 2.4);
        for (&(_, b), &(_, grab)) in beams.iter().zip(&hoist) {
            let b = rel_pos(b);
            gl.uniform3f(self.u("s_center"), b.x, b.y, b.z);
            gl.uniform3f(self.u("s_end"), grab.x, grab.y, grab.z);
            gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
        }
        gl.uniform1i(self.u("s_kind"), 0);
        gl.uniform3f(self.u("s_core"), 1.0, 0.4, 0.3);
        gl.uniform3f(self.u("s_glow"), 0.9, 0.05, 0.0);
        gl.uniform1f(self.u("s_size"), 4.5);
        for &(_, grab) in &hoist {
            gl.uniform3f(self.u("s_center"), grab.x, grab.y, grab.z);
            gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
        }
        for inst in instances.iter().filter(|i| i.model < 0) {
            let fire = match inst.model {
                SPRITE_EXPLOSION => Some(15.0),
                SPRITE_IMPACT => Some(3.5),
                _ => None,
            };
            if let Some(size) = fire {
                let d = rel(inst);
                gl.uniform1i(self.u("s_kind"), 3);
                gl.uniform1f(self.u("s_seed"), ((inst.pos[0] ^ (inst.pos[2] >> 3)) & 1023) as f32 / 97.0);
                gl.uniform3f(self.u("s_center"), d.x, d.y, d.z);
                gl.uniform1f(self.u("s_size"), size * inst.scale as f32 / 256.0);
                gl.uniform3f(self.u("s_core"), inst.alpha as f32 / 255.0, 0.0, 0.0);
                gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
                continue;
            }
            gl.uniform1i(self.u("s_kind"), 0);
            let (size, core, glow) = match inst.model {
                SPRITE_PULSE => (8.0, [0.75, 0.85, 1.0], [0.2, 0.4, 1.0]),
                SPRITE_FIREBALL => (7.0, [1.0, 0.9, 0.5], [1.0, 0.45, 0.05]),
                SPRITE_MISSILE => (7.0, [1.0, 0.85, 0.4], [1.0, 0.15, 0.03]),
                SPRITE_SMOKE => (17.0, [0.4, 0.4, 0.42], [0.3, 0.3, 0.32]),
                _ => continue,
            };
            let fade = inst.alpha as f32 / 255.0;
            let (core, glow) = (core.map(|c| c * fade), glow.map(|c| c * fade));
            let d = rel(inst);
            if d.x * d.x + d.z * d.z > far2 {
                continue;
            }
            gl.uniform3f(self.u("s_center"), d.x, d.y, d.z);
            gl.uniform1f(self.u("s_size"), size * inst.scale as f32 / 256.0);
            gl.uniform3f(self.u("s_core"), core[0], core[1], core[2]);
            gl.uniform3f(self.u("s_glow"), glow[0], glow[1], glow[2]);
            gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
        }
        // Lock-on ring: drawn over everything so the target stays marked behind cover.
        gl.blend_func(GL::SRC_ALPHA, GL::ONE_MINUS_SRC_ALPHA);
        gl.disable(GL::DEPTH_TEST);
        gl.uniform1i(self.u("s_kind"), 1);
        gl.uniform3f(self.u("s_core"), 1.0, 0.86, 0.18);
        for inst in instances.iter().filter(|i| i.model == SPRITE_TARGET) {
            let d = rel(inst);
            gl.uniform3f(self.u("s_center"), d.x, d.y, d.z);
            gl.uniform1f(self.u("s_size"), 12.0 * inst.scale as f32 / 256.0);
            gl.draw_arrays(GL::TRIANGLE_STRIP, 0, 4);
        }
        gl.enable(GL::DEPTH_TEST);
        gl.depth_mask(true);
        gl.disable(GL::BLEND);
        gl.bind_vertex_array(None);
        self.draw_texts(&proj, aspect, cam.fov, texts);
    }
}

/// Rotor uniforms share names with the model program; prefix them in the lookup map.
fn rname(name: &'static str) -> &'static str {
    match name {
        "u_viewproj" => "r_viewproj",
        "u_model" => "r_model",
        "u_center" => "r_center",
        "u_axis_u" => "r_axis_u",
        "u_axis_v" => "r_axis_v",
        "u_radius" => "r_radius",
        "u_spin" => "r_spin",
        other => other,
    }
}

/// Text uniforms share names with the model program; prefix them in the lookup map.
fn xname(name: &'static str) -> &'static str {
    match name {
        "u_proj" => "x_proj",
        "u_model" => "x_model",
        "u_alpha" => "x_alpha",
        other => other,
    }
}

/// Sprite uniforms share names with the model program; prefix them in the lookup map.
fn sname(name: &'static str) -> &'static str {
    match name {
        "u_viewproj" => "s_viewproj",
        "u_center" => "s_center",
        "u_right" => "s_right",
        "u_up" => "s_up",
        "u_size" => "s_size",
        "u_core" => "s_core",
        "u_glow" => "s_glow",
        "u_end" => "s_end",
        "u_kind" => "s_kind",
        "u_time" => "s_time",
        "u_seed" => "s_seed",
        other => other,
    }
}

/// Terrain uniforms share names with the model program; prefix them in the lookup map.
fn tname(name: &'static str) -> &'static str {
    match name {
        "u_origin" => "t_origin",
        "u_cam_frac" => "t_cam_frac",
        "u_viewproj" => "t_viewproj",
        "u_height" => "t_height",
        "u_colour" => "t_colour",
        "u_fog" => "t_fog",
        "u_fog_range" => "t_fog_range",
        "u_time" => "t_time",
        "u_cell" => "t_cell",
        "u_ground" => "t_ground",
        "u_has_ground" => "t_has_ground",
        other => other,
    }
}

