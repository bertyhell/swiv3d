//! The game world: terrain, entities spawned from `start_objects`, weapons and objectives.
//!
//! Player flight is an exact port (see [`crate::heli`]). Enemy behaviours are rebuilt from
//! the `OBJECT_*` / `OBFUNC_*` structure of the original (turret base + top, tank + top,
//! spawners with radar tops, pickups, objectives registered from `params[1] = 5000 + group`);
//! their tuning constants are approximations until each function is fully decompiled.

use crate::heli::{Heli, Input};
use crate::trig::{self, cos, sin};
use swiv_formats::level::{Level, Spawn, SpawnKind, CELL_SHIFT, HEIGHT_SHIFT, MAP_SIZE};

/// One logic tick per rendered frame in the original; 30 Hz is the reference rate here.
pub const TICK_HZ: u32 = 30;
/// Model coordinates are scaled by 256 into world units (same as spawn coordinates).
pub const MODEL_SHIFT: i32 = 8;
pub const WORLD_SIZE: i32 = (MAP_SIZE as i32) << CELL_SHIFT;
const HALF_WORLD: i32 = WORLD_SIZE / 2;

pub const PLAYER_MODEL: i32 = 990;
pub const BUGGY_MODEL: i32 = 991;
/// Billboard sprites (negative ids so they never collide with level models): the player's
/// blue energy pulse and the orange fireball enemies shoot.
pub const SPRITE_PULSE: i32 = -1;
pub const SPRITE_FIREBALL: i32 = -2;
/// Player missiles (orange core, red glow) and the yellow lock-on ring over the auto-target.
pub const SPRITE_MISSILE: i32 = -3;
pub const SPRITE_TARGET: i32 = -4;
/// Grey smoke puff rising from wrecks.
pub const SPRITE_SMOKE: i32 = -5;
/// Fireball (explosions, burning trees) and the small burst where a pulse hits the ground.
/// The original's explosion models (767..770) are coloured from `_GLOBAL_flametab`, which is
/// not decoded yet, so explosions are procedural fireballs.
pub const SPRITE_EXPLOSION: i32 = -6;
pub const SPRITE_IMPACT: i32 = -7;
/// Wreck burn times (ticks): building smoke, building flames, a tree's flame column and
/// the flames it leaves burning on the stump.
const WRECK_SMOKE_TICKS: i32 = 15 * TICK_HZ as i32;
const WRECK_FIRE_TICKS: i32 = 6 * TICK_HZ as i32;
const TREE_COLUMN_TICKS: i32 = 40;
const TREE_BURN_TICKS: i32 = 5 * TICK_HZ as i32;
/// Peak brightness (alpha, of 255) of a burning tree's fire.
const MUSHROOM_BRIGHTNESS: i32 = 150;
/// Height of a standing tree from foot to crown (models 560..565 are 74..110 units tall).
const TREE_HEIGHT: i32 = 88 << MODEL_SHIFT;
/// How far a destroyed building collapses (256 = full height).
const RUBBLE_SQUASH: i32 = 80;
/// Special weapons, indexed like their names in `GLOBAL.BD` strings group 100
/// ("Missiles", "Homing Missiles", ... "Thruster"). A pickup's `params[1] - 1000` is that index.
pub const SPECIAL_COUNT: usize = 20;
/// Pickup `params[1] - 1000` codes beyond the specials.
const PICKUP_HEALTH_10: i32 = 100;
const PICKUP_HEALTH_25: i32 = 101;
const PICKUP_HEALTH_MEGA: i32 = 102;
const PICKUP_SHIELD: i32 = 107;
/// The shield orbits the craft until it has soaked up this much health damage.
const SHIELD_DAMAGE: i32 = 25;
const SHIELD_MODEL: i32 = 853;
const PICKUP_POWER_UP: std::ops::RangeInclusive<i32> = 110..=113;
/// The gun fires in bursts of two pulses, "one, two, pause": `PULSE_GAP` ticks between the
/// two pulses, `BURST_PERIOD` from burst to burst. Measured on the original running in
/// DOSBox with the trigger held: pairs ~0.23 s apart, ~2.5 pulses a second overall.
const PULSE_GAP: i32 = 7;
const BURST_PERIOD: i32 = 24;
const BURST_PULSES: i32 = 2;
/// What one pulse does.
pub const PULSE_DAMAGE: i32 = 4;
/// Gun pulses it takes to bring down scenery: trees, electricity pylons (models 552/553)
/// and houses (8 impacts from first hit to explosion on the original in DOSBox). Objective buildings keep their data hit points but never go
/// down faster than a house.
const TREE_HITS: i32 = 2;
const PYLON_HITS: i32 = 3;
const HOUSE_HITS: i32 = 8;
/// Ammo per special pickup (the footage shows Missiles going x00 -> x06 -> x12).
const SPECIAL_AMMO: i32 = 6;
/// Ticks the tractor beam takes to winch a pickup aboard, and the extra weight it puts on
/// the craft meanwhile (the hover controller settles about `PICKUP_LOAD / 2` units lower).
/// The winch takes as long as its sound (effect 4000, 1.58 s), which starts with the beam and
/// ends as the collectable comes aboard.
const PICKUP_BEAM_TICKS: i32 = 48;
const PICKUP_LOAD: i32 = 60;
/// Aircraft and drones wait at their spawn point until the player comes this close (cells),
/// roughly the edge of the screen with the original's camera.
const AIR_WAKE_CELLS: i32 = 14;
/// Default `World::target_range`: half the web build's default fog distance (3600 / 64 / 2).
const TARGET_RANGE_CELLS: i32 = 28;
const DEBRIS_MODELS: [i32; 4] = [700, 701, 702, 703];

/// Shortest signed distance on the wrapping map.
#[inline]
pub fn wrap(d: i32) -> i32 {
    ((d + HALF_WORLD).rem_euclid(WORLD_SIZE)) - HALF_WORLD
}

#[derive(Clone)]
pub struct Terrain {
    pub hmap: Vec<u8>,
    pub tmap: Vec<u8>,
}

impl Terrain {
    pub fn from_level(l: &Level) -> Self {
        Terrain { hmap: l.hmap.clone(), tmap: l.tmap.clone() }
    }

    /// `LSCAPE_GetMapH`.
    pub fn height(&self, x: i32, z: i32) -> i32 {
        let (cx, cz) = (x >> CELL_SHIFT, z >> CELL_SHIFT);
        let (fx, fz) = ((x >> 6) & 0xff, (z >> 6) & 0xff);
        let h = |dx: i32, dz: i32| (Level::cell(&self.hmap, cx + dx, cz + dz) as i32) << HEIGHT_SHIFT;
        let (h00, h10, h01, h11) = (h(0, 0), h(1, 0), h(0, 1), h(1, 1));
        let top = h00 + (((h10 - h00) * fx) >> 8);
        let bot = h01 + (((h11 - h01) * fx) >> 8);
        top + (((bot - top) * fz) >> 8)
    }

    pub fn is_water(&self, x: i32, z: i32) -> bool {
        Level::cell(&self.tmap, x >> CELL_SHIFT, z >> CELL_SHIFT) == 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Brain {
    Static,
    Turret,
    Tank,
    Boat,
    Aircraft,
    Drone,
    Spawner { spawns_aircraft: bool },
    Pickup,
}

#[derive(Debug, Clone)]
pub struct Entity {
    pub class: i32,
    pub brain: Brain,
    pub model: i32,
    pub top_model: Option<i32>,
    pub pos: [i32; 3],
    pub vel: [i32; 3],
    pub yaw: i32,
    pub top_yaw: i32,
    pub health: i32,
    pub max_health: i32,
    pub radius: i32,
    pub y_min: i32,
    pub objective: Option<u8>,
    pub alive: bool,
    pub hostile: bool,
    pub cooldown: i32,
    pub timer: i32,
    pub pickup: i32,
    pub hit_flash: u8,
    pub score: i32,
    /// Aircraft / drones: set once the player has come within `AIR_WAKE_CELLS`.
    pub awake: bool,
    /// Pickups: where the collectable floats (it spins above its static platform and is
    /// winched up to the craft by the tractor beam), and whether the beam has it.
    pub item_pos: [i32; 3],
    pub beaming: bool,
    /// Destroyed scenery: buildings stay as smoking black rubble and trees as burnt stumps
    /// (`timer` counts ticks since). Wrecks no longer stop shots or count as targets.
    pub wrecked: bool,
    /// Wrecked and swapped for its `LEVEL_debris` remains (rubble or a stump), drawn as is;
    /// otherwise a wreck is drawn as the original model, charred and collapsed.
    pub remains: bool,
    /// Pickup (`params[1] - 1000` code) left in the ruins when this building is destroyed.
    pub drop: Option<i32>,
}

/// What a special weapon does when fired (approximations until `WEAPON_*` is decompiled).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpecialFire {
    Rockets { count: i32, damage: i32 },
    Homing { count: i32 },
    Burst { count: i32 },
    Bomb { radius_cells: i32 },
    Boost,
}

fn special_fire(kind: usize) -> SpecialFire {
    use SpecialFire::*;
    match kind {
        0 => Rockets { count: 1, damage: 25 },     // Missiles
        1 => Homing { count: 1 },                  // Homing Missiles
        2 => Burst { count: 5 },                   // MultiFire
        3 => Rockets { count: 1, damage: 45 },     // Cruise Missiles
        4 => Homing { count: 3 },                  // MultiTarget
        5 => Burst { count: 12 },                  // Star Burst
        6 => Rockets { count: 1, damage: 60 },     // Mortar Bomb
        7 => Bomb { radius_cells: 24 },            // Smart Bomb
        8 => Bomb { radius_cells: 10 },            // Napalm
        10 => Rockets { count: 3, damage: 25 },    // Triple Missiles
        11 => Homing { count: 4 },                 // Quad Homing
        12 => Burst { count: 9 },                  // MegaFire
        13 => Rockets { count: 1, damage: 80 },    // Super Cruise
        14 => Homing { count: 6 },                 // MegaTarget
        15 => Burst { count: 24 },                 // Power Burst
        16 => Rockets { count: 1, damage: 100 },   // Super Mortar
        17 => Bomb { radius_cells: 40 },           // Mega Bomb
        18 => Bomb { radius_cells: 16 },           // Super Napalm
        _ => Boost,                                // Jump Boost!, Thruster
    }
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub pos: [i32; 3],
    pub vel: [i32; 3],
    pub from_player: bool,
    pub damage: i32,
    pub life: i32,
    pub model: i32,
    pub target: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Effect {
    pub pos: [i32; 3],
    pub vel: [i32; 3],
    pub age: i32,
    pub life: i32,
    pub model: i32,
    pub size: i32,
    /// Growth of `scale` per tick (per unit of size).
    pub grow: i32,
    pub spin: i32,
    pub gravity: bool,
    /// Mushroom-cloud gas (nonzero): rises fast, then near this height stalls and turns
    /// outwards along its small initial sideways drift, sinking a little at the rim.
    pub cap_y: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    PlayerShot,
    EnemyShot,
    Explosion { big: bool },
    Hit,
    /// The tractor beam has grabbed a pickup and starts winching it up.
    PickupStart,
    /// A pickup came aboard: its `params[1] - 1000` code (the GLOBAL.BD string index).
    Pickup(i32),
    PlayerHit,
    PlayerDied,
    ObjectiveDone(u8),
    LevelComplete,
    GameOver,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Instance {
    pub model: i32,
    pub pos: [i32; 3],
    pub yaw: i32,
    pub pitch: i32,
    pub roll: i32,
    /// 256 = original size
    pub scale: i32,
    pub flash: bool,
    /// Extra vertical scale (256 = none), for collapsed rubble and burnt stumps.
    pub squash: i32,
    /// Burnt black.
    pub charred: bool,
    /// Sprites: brightness 0..255 (fades smoke and flames out).
    pub alpha: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Playing,
    Dead,
    Complete,
    GameOver,
}

pub struct World {
    pub terrain: Terrain,
    debris: swiv_formats::debris::Debris,
    pub model_info: std::collections::HashMap<i32, (i32, i32)>,
    /// Highest vertex of each model (world units), to stand collectables on their platforms.
    model_top: std::collections::HashMap<i32, i32>,
    pub entities: Vec<Entity>,
    pub projectiles: Vec<Projectile>,
    pub effects: Vec<Effect>,
    pub player: Heli,
    pub start: ([i32; 3], i32),
    pub health: i32,
    pub lives: i32,
    pub score: i32,
    /// Primary gun power (Power Up pickups): 1 + level energy pulses per shot.
    pub weapon_level: i32,
    /// Damage the orbiting shield can still take before it wears off (0 = no shield).
    pub shield: i32,
    /// Orbit angle of the shield around the craft.
    pub shield_angle: i32,
    /// Special weapon ammo per kind, and the selected kind (None = empty).
    pub ammo: [i32; SPECIAL_COUNT],
    pub special: Option<usize>,
    pub fire_cooldown: i32,
    /// Pulses fired so far in the current burst.
    burst: i32,
    special_cooldown: i32,
    pub tick: u64,
    pub phase: Phase,
    pub phase_timer: i32,
    pub objectives_total: [u16; 10],
    pub objectives_left: [u16; 10],
    /// The objective group the player last destroyed a target of; the HUD follows it while it
    /// has targets left, so groups taken out of order still count up.
    objective_focus: Option<u8>,
    pub events: Vec<Event>,
    pub max_height: i32,
    pub target: Option<usize>,
    /// How far (in cells) auto-targeting and homing reach; the front end sets it to half
    /// the fog distance so nothing can be locked onto out at the horizon.
    pub target_range: i32,
    rng: u32,
    prev_input: Input,
}

/// Buildings and trees (`OBJECT_pose3`, classes 2000..2004): shootable, wrecked when destroyed.
fn is_scenery(e: &Entity) -> bool {
    e.brain == Brain::Static && (2000..=2004).contains(&e.class)
}

/// A building's second spawn model names the pickup hidden in it: the collectable models
/// map to pickup codes as on the levels' pickup spawns. 850 (MultiFire) is on most buildings
/// yet never turns up in the footage, so it is read as "nothing".
fn building_drop(model2: i32) -> Option<i32> {
    Some(match model2 {
        800 => 0,
        801 => 1,
        856 => 3,
        854 => 4,
        855 => 5,
        811 => 6,
        812 => 7,
        858 => 8,
        981 => 9,
        813 => 19,
        605 => PICKUP_HEALTH_10,
        606 => PICKUP_HEALTH_25,
        607 => PICKUP_HEALTH_MEGA,
        851 => 105,
        852 => 106,
        853 => 107,
        608 => 110,
        _ => return None,
    })
}

/// The collectable model for a pickup code (inverse of [`building_drop`]).
fn pickup_model(code: i32) -> i32 {
    match code {
        0 => 800,
        1 => 801,
        3 => 856,
        4 => 854,
        5 => 855,
        6 => 811,
        7 => 812,
        8 => 858,
        9 => 981,
        19 => 813,
        PICKUP_HEALTH_10 => 605,
        PICKUP_HEALTH_25 => 606,
        PICKUP_HEALTH_MEGA => 607,
        105 => 851,
        106 => 852,
        107 => 853,
        _ => 608,
    }
}

/// Trees (`OBJECT_pose3` classes 2002/2003, models 560..565) burn down to a stump.
fn is_tree(class: i32) -> bool {
    matches!(class, 2002 | 2003)
}

fn brain_for(s: &Spawn) -> Brain {
    match s.kind() {
        SpawnKind::Turret | SpawnKind::Pillbox | SpawnKind::Boss => Brain::Turret,
        SpawnKind::Tank => Brain::Tank,
        SpawnKind::Boat => Brain::Boat,
        SpawnKind::Aircraft => Brain::Aircraft,
        SpawnKind::Drone => Brain::Drone,
        SpawnKind::Spawner => Brain::Spawner { spawns_aircraft: s.class >= 6100 },
        SpawnKind::Pickup => Brain::Pickup,
        _ => Brain::Static,
    }
}

impl World {
    pub fn new(level: &Level) -> World {
        let terrain = Terrain::from_level(level);
        let model_info = level
            .models
            .iter()
            .map(|(&id, m)| (id as i32 - 10000, ((m.radius() as i32).max(4) << MODEL_SHIFT, m.y_min << MODEL_SHIFT)))
            .collect::<std::collections::HashMap<_, _>>();
        let model_top = level
            .models
            .iter()
            .map(|(&id, m)| (id as i32 - 10000, m.vertices.iter().map(|v| v.pos[1]).max().unwrap_or(0) << MODEL_SHIFT))
            .collect();
        let mut w = World {
            terrain,
            debris: level.debris.clone(),
            model_info,
            model_top,
            entities: Vec::new(),
            projectiles: Vec::new(),
            effects: Vec::new(),
            player: Heli::new([0; 3], 0),
            start: ([0; 3], 0),
            health: 100,
            lives: 1,
            score: 0,
            weapon_level: 0,
            shield: 0,
            shield_angle: 0,
            ammo: [0; SPECIAL_COUNT],
            special: None,
            fire_cooldown: 0,
            burst: 0,
            special_cooldown: 0,
            tick: 0,
            phase: Phase::Playing,
            phase_timer: 0,
            objectives_total: [0; 10],
            objectives_left: [0; 10],
            objective_focus: None,
            events: Vec::new(),
            max_height: 255 << HEIGHT_SHIFT,
            target: None,
            target_range: TARGET_RANGE_CELLS,
            rng: 0x5357_4956,
            prev_input: Input::default(),
        };
        for s in &level.spawns {
            w.add_spawn(s);
        }
        w.objectives_left = w.objectives_total;
        w.respawn();
        w
    }

    fn info(&self, model: i32) -> (i32, i32) {
        self.model_info.get(&model).copied().unwrap_or((4 << MODEL_SHIFT, 0))
    }

    fn add_spawn(&mut self, s: &Spawn) {
        let (x, z) = s.world_pos();
        let yaw = s.angle & trig::ANGLE_MASK;
        if matches!(s.kind(), SpawnKind::PlayerStart) {
            if s.class == 1000 || self.start.0 == [0; 3] {
                self.start = ([x, 0, z], yaw);
            }
            // The landing pad / base model stays in the world.
        }
        let brain = if matches!(s.kind(), SpawnKind::PlayerStart) { Brain::Static } else { brain_for(s) };
        let (radius, y_min) = self.info(s.model);
        let objective = match s.params[1] {
            g @ 5000..=5009 => Some((g - 5000) as u8),
            _ => None,
        };
        if let Some(g) = objective {
            self.objectives_total[g as usize] += 1;
        }
        let top_model = match brain {
            Brain::Turret | Brain::Tank | Brain::Boat | Brain::Pickup => self.model_info.contains_key(&s.model2).then_some(s.model2),
            Brain::Spawner { .. } => self.model_info.contains_key(&s.model2).then_some(s.model2),
            _ => None,
        };
        let ground = match brain {
            Brain::Boat => self.terrain.height(x, z).max(0),
            // Pickup platforms are flat pads: rest them on the highest ground they cover so
            // they never sink into a slope.
            Brain::Pickup => self.footprint_height(x, z, radius),
            _ => self.terrain.height(x, z),
        };
        let fly = matches!(brain, Brain::Aircraft | Brain::Drone);
        let y = ground - y_min + if fly { 30 << 8 << 3 } else { 0 };
        let hostile = !matches!(brain, Brain::Static | Brain::Pickup);
        let health = match s.params[0] {
            h if h > 0 => h,
            _ => 10,
        };
        let health = match (s.class, s.model) {
            (2002 | 2003, _) => TREE_HITS * PULSE_DAMAGE,
            (2000..=2004, 552 | 553) => PYLON_HITS * PULSE_DAMAGE,
            (2000..=2004, _) if objective.is_some() => health.max(HOUSE_HITS * PULSE_DAMAGE),
            (2000..=2004, _) => HOUSE_HITS * PULSE_DAMAGE,
            _ => health,
        };
        self.entities.push(Entity {
            class: s.class,
            brain,
            model: s.model,
            top_model,
            pos: [x, y, z],
            vel: [0; 3],
            yaw,
            top_yaw: yaw,
            health,
            max_health: health,
            radius,
            y_min,
            objective,
            alive: true,
            hostile,
            cooldown: (self.entities.len() as i32 * 7) % 60,
            timer: 0,
            pickup: s.params[1] - 1000,
            hit_flash: 0,
            score: health * 10,
            awake: false,
            item_pos: [x, y + self.item_rest_height(s.model, s.model2), z],
            beaming: false,
            wrecked: false,
            remains: false,
            drop: if (2000..=2004).contains(&s.class) { building_drop(s.model2) } else { None },
        });
    }

    /// Highest terrain under a disc of `radius` (centre plus eight points on the rim).
    fn footprint_height(&self, x: i32, z: i32, radius: i32) -> i32 {
        // Sample a grid over the whole square footprint (half a terrain cell apart) so a
        // ridge or bump under the middle of the pad is caught, not just the rim.
        const STEP: i32 = 1 << 13;
        let n = (radius / STEP).max(1);
        let step = radius / n;
        let mut h = self.terrain.height(x, z);
        for i in -n..=n {
            for j in -n..=n {
                h = h.max(self.terrain.height(x + i * step, z + j * step));
            }
        }
        h
    }

    /// Height of a collectable's origin above its platform's origin: standing on the top
    /// face with a little air underneath.
    fn item_rest_height(&self, platform: i32, item: i32) -> i32 {
        let top = self.model_top.get(&platform).copied().unwrap_or(0);
        let (_, item_y_min) = self.info(item);
        top - item_y_min + (6 << MODEL_SHIFT)
    }

    fn rand(&mut self) -> u32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        self.rng
    }

    fn rand_range(&mut self, lo: i32, hi: i32) -> i32 {
        lo + (self.rand() % ((hi - lo).max(1) as u32)) as i32
    }

    pub fn respawn(&mut self) {
        let ([x, _, z], yaw) = self.start;
        let y = self.terrain.height(x, z) + ((crate::heli::HOVER) << 8);
        self.player = Heli::new([x, y, z], yaw);
        self.health = 100;
        self.shield = 0;
        self.phase = Phase::Playing;
    }

    pub fn current_objective(&self) -> Option<u8> {
        self.objective_focus
            .filter(|&g| self.objectives_left[g as usize] > 0)
            .or_else(|| (0..10u8).find(|&g| self.objectives_left[g as usize] > 0))
    }

    pub fn step(&mut self, input: &Input) {
        self.tick += 1;
        self.events.clear();
        match self.phase {
            Phase::Playing => {
                self.player.control(input, self.max_height);
                if self.player.step(&self.terrain) {
                    self.damage_player(10);
                    let p = self.player.pos;
                    self.explode(p, false);
                }
                self.player_weapons(input);
            }
            Phase::Dead => {
                self.phase_timer -= 1;
                if self.phase_timer <= 0 {
                    if self.lives > 0 {
                        self.respawn();
                    } else {
                        self.phase = Phase::GameOver;
                        self.events.push(Event::GameOver);
                    }
                }
            }
            Phase::Complete | Phase::GameOver => {}
        }
        if self.shield > 0 {
            self.shield_angle = (self.shield_angle + 8) & trig::ANGLE_MASK;
        }
        self.update_entities();
        self.update_projectiles();
        self.update_effects();
        self.prev_input = *input;
    }

    fn damage_player(&mut self, dmg: i32) {
        if self.phase != Phase::Playing {
            return;
        }
        self.health -= dmg;
        self.shield = (self.shield - dmg).max(0);
        self.events.push(Event::PlayerHit);
        if self.health <= 0 {
            self.lives -= 1;
            self.phase = Phase::Dead;
            self.phase_timer = 3 * TICK_HZ as i32;
            let p = self.player.pos;
            self.explode(p, true);
            self.events.push(Event::PlayerDied);
        }
    }

    fn forward(&self) -> [i32; 3] {
        let a = self.player.yaw;
        [sin(a), 0, cos(a)]
    }

    /// Auto-target (`CONTROL_search_target`): the nearest live target inside a forward cone
    /// that the guns have a clear line of sight to.
    /// Enemy aircraft come first, then other hostiles, then objective buildings, then any
    /// other building or tree.
    fn find_target(&self) -> Option<usize> {
        let p = self.player.pos;
        let yaw = self.player.yaw;
        let mut best: Option<(u8, i64, usize)> = None;
        for (i, e) in self.entities.iter().enumerate() {
            let scenery = is_scenery(e);
            if !e.alive || e.wrecked || !(e.hostile || e.objective.is_some() || scenery) {
                continue;
            }
            let dx = wrap(e.pos[0] - p[0]);
            let dz = wrap(e.pos[2] - p[2]);
            let d2 = dx as i64 * dx as i64 + dz as i64 * dz as i64;
            if d2 > ((self.target_range as i64) << CELL_SHIFT).pow(2) {
                continue;
            }
            if trig::delta(yaw, trig::atan2(dx, dz)).abs() > 40 {
                continue;
            }
            let rank = match e.brain {
                Brain::Aircraft | Brain::Drone => 0,
                _ if e.hostile => 1,
                _ if e.objective.is_some() => 2,
                _ => 3,
            };
            if best.is_none_or(|b| (rank, d2) < (b.0, b.1)) && self.gun_can_see(e) {
                best = Some((rank, d2, i));
            }
        }
        best.map(|b| b.2)
    }

    fn player_weapons(&mut self, input: &Input) {
        if self.tick % 4 == 0 {
            self.target = self.find_target();
        }
        if input.next_weapon && !self.prev_input.next_weapon {
            self.cycle_special(1);
        }
        if input.prev_weapon && !self.prev_input.prev_weapon {
            self.cycle_special(-1);
        }
        if self.fire_cooldown > 0 {
            self.fire_cooldown -= 1;
        }
        if self.special_cooldown > 0 {
            self.special_cooldown -= 1;
        }
        if input.fire && self.fire_cooldown == 0 {
            self.fire_pulses();
        } else if !input.fire && self.fire_cooldown == 0 {
            self.burst = 0; // a fresh press starts a new burst
        }
        if input.special && self.special_cooldown == 0 {
            if let Some(k) = self.special {
                self.ammo[k] -= 1;
                self.fire_special(k);
                if self.ammo[k] <= 0 {
                    self.cycle_special(1);
                }
            }
        }
    }

    /// Select the next special weapon kind that still has ammo (None when all are empty).
    fn cycle_special(&mut self, d: i32) {
        let n = SPECIAL_COUNT as i32;
        let from = self.special.map_or(if d > 0 { -1 } else { 0 }, |k| k as i32);
        self.special = (1..=n).map(|i| (from + d * i).rem_euclid(n) as usize).find(|&k| self.ammo[k] > 0);
    }

    fn aim_vector(&self, speed: i32) -> [i32; 3] {
        let p = self.player.pos;
        if let Some(t) = self.target.and_then(|i| self.entities.get(i)) {
            let a = Self::aim_point(t);
            let d = [wrap(a[0] - p[0]), a[1] - p[1], wrap(a[2] - p[2])];
            let len = ((d[0] as f64).powi(2) + (d[1] as f64).powi(2) + (d[2] as f64).powi(2)).sqrt().max(1.0);
            return d.map(|c| (c as f64 / len * speed as f64) as i32);
        }
        let f = self.forward();
        // Without a target the guns angle down to meet the ground ~10 cells ahead.
        [f[0] * speed / 256 + self.player.vel[0], -speed / 10, f[2] * speed / 256 + self.player.vel[2]]
    }

    /// Where the guns aim on a target (see `aim_vector`).
    fn aim_point(e: &Entity) -> [i32; 3] {
        [e.pos[0], e.pos[1] - e.y_min / 2, e.pos[2]]
    }

    /// Whether the straight line from the guns to `e` clears the terrain, sampled every
    /// quarter cell. A little slack lets a shot graze the ground just in front of a target
    /// sitting on a slope.
    fn gun_can_see(&self, e: &Entity) -> bool {
        const SLACK: i32 = 4 << MODEL_SHIFT;
        let from = self.muzzle();
        let to = Self::aim_point(e);
        let d = [wrap(to[0] - from[0]) as i64, (to[1] - from[1]) as i64, wrap(to[2] - from[2]) as i64];
        let steps = (((d[0] as f64).hypot(d[2] as f64) as i64) >> (CELL_SHIFT - 2)).max(1);
        (1..steps).all(|k| {
            let at = |c: usize| from[c] + (d[c] * k / steps) as i32;
            at(1) + SLACK >= self.terrain.height(at(0), at(2))
        })
    }

    fn muzzle(&self) -> [i32; 3] {
        let p = self.player.pos;
        [p[0], p[1] - (8 << MODEL_SHIFT), p[2]]
    }

    /// Primary gun: single energy pulses at the auto-target in two-pulse bursts (see
    /// `BURST_PERIOD`). Each Power Up adds a pulse to every shot, fanned out sideways.
    fn fire_pulses(&mut self) {
        let muzzle = self.muzzle();
        let base = self.aim_vector(12000);
        let side = self.player.yaw + 128;
        let n = 1 + self.weapon_level;
        for k in 0..n {
            let off = 2 * k - (n - 1); // 0 / -1, 1 / -2, 0, 2 / ...
            let pos = [muzzle[0] + sin(side) * off * 3, muzzle[1], muzzle[2] + cos(side) * off * 3];
            let fan = off * 400;
            let vel = [base[0] + sin(side) * fan / 256, base[1], base[2] + cos(side) * fan / 256];
            self.projectiles.push(Projectile { pos, vel, from_player: true, damage: PULSE_DAMAGE, life: 45, model: SPRITE_PULSE, target: None });
        }
        self.burst += 1;
        self.fire_cooldown = if self.burst < BURST_PULSES {
            PULSE_GAP
        } else {
            self.burst = 0;
            BURST_PERIOD - PULSE_GAP * (BURST_PULSES - 1)
        };
        self.events.push(Event::PlayerShot);
    }

    fn fire_special(&mut self, kind: usize) {
        let muzzle = self.muzzle();
        let side = self.player.yaw + 128;
        let missile = |vel, damage, target| Projectile { pos: muzzle, vel, from_player: true, damage, life: 60, model: SPRITE_MISSILE, target };
        match special_fire(kind) {
            SpecialFire::Rockets { count, damage } => {
                let base = self.aim_vector(9000);
                for k in 0..count {
                    let fan = (k - (count - 1) / 2) * 900;
                    let vel = [base[0] + sin(side) * fan / 256, base[1], base[2] + cos(side) * fan / 256];
                    self.projectiles.push(missile(vel, damage, None));
                }
                self.special_cooldown = 10;
            }
            SpecialFire::Homing { count } => {
                let targets = self.targets_ahead(count as usize);
                let base = self.aim_vector(6000);
                for k in 0..count {
                    let t = targets.get(k as usize % targets.len().max(1)).copied();
                    let fan = (k - (count - 1) / 2) * 1500;
                    let vel = [base[0] + sin(side) * fan / 256, base[1] + 1500, base[2] + cos(side) * fan / 256];
                    self.projectiles.push(missile(vel, 30, t));
                }
                self.special_cooldown = 14;
            }
            SpecialFire::Burst { count } => {
                let spread = if count > 9 { 512 } else { 160 };
                for k in 0..count {
                    let a = self.player.yaw - spread / 2 + spread * k / count.max(1) + if spread == 512 { 0 } else { spread / count / 2 };
                    let vel = [sin(a) * 12000 / 256, -800, cos(a) * 12000 / 256];
                    self.projectiles.push(Projectile { pos: muzzle, vel, from_player: true, damage: 8, life: 40, model: SPRITE_PULSE, target: None });
                }
                self.special_cooldown = 12;
            }
            SpecialFire::Bomb { radius_cells } => {
                self.smart_bomb(radius_cells);
                self.special_cooldown = 30;
            }
            SpecialFire::Boost => {
                self.player.vel[1] += 6000;
                self.special_cooldown = 30;
            }
        }
        self.events.push(Event::PlayerShot);
    }

    /// Up to `n` live hostiles ahead of the craft, nearest first (for multi-target homing).
    fn targets_ahead(&self, n: usize) -> Vec<usize> {
        let p = self.player.pos;
        let mut v: Vec<(i64, usize)> = self
            .entities
            .iter()
            .enumerate()
            .filter(|(_, e)| e.alive && e.hostile)
            .filter_map(|(i, e)| {
                let (dx, dz) = (wrap(e.pos[0] - p[0]), wrap(e.pos[2] - p[2]));
                let d2 = dx as i64 * dx as i64 + dz as i64 * dz as i64;
                let ahead = trig::delta(self.player.yaw, trig::atan2(dx, dz)).abs() <= 64;
                (ahead && d2 < ((self.target_range as i64) << CELL_SHIFT).pow(2)).then_some((d2, i))
            })
            .collect();
        v.sort();
        let mut out: Vec<usize> = self.target.into_iter().collect();
        out.extend(v.into_iter().map(|x| x.1).filter(|i| Some(*i) != self.target));
        out.truncate(n);
        out
    }

    fn smart_bomb(&mut self, radius_cells: i32) {
        let p = self.player.pos;
        let r = (radius_cells as i64) << CELL_SHIFT;
        for i in 0..self.entities.len() {
            let e = &self.entities[i];
            if !e.alive || !e.hostile {
                continue;
            }
            let (dx, dz) = (wrap(e.pos[0] - p[0]) as i64, wrap(e.pos[2] - p[2]) as i64);
            if dx * dx + dz * dz < r * r {
                self.hurt_entity(i, 200);
            }
        }
        self.explode(p, true);
    }

    /// Damage entity `i`; at zero health it is destroyed (or wrecked, for scenery).
    pub fn hurt(&mut self, i: usize, dmg: i32) {
        self.hurt_entity(i, dmg);
    }

    fn hurt_entity(&mut self, i: usize, dmg: i32) {
        let e = &mut self.entities[i];
        if !e.alive {
            return;
        }
        e.health -= dmg;
        e.hit_flash = 3;
        // Parked aircraft shot from beyond their wake range take off and attack.
        if matches!(e.brain, Brain::Aircraft | Brain::Drone) {
            e.awake = true;
        }
        if e.health > 0 {
            self.events.push(Event::Hit);
            // Shot-up scenery sheds chips (`LEVEL_debris` variant 2).
            let (pos, model) = (e.pos, e.model);
            if is_scenery(e) {
                let chips = self.debris.get(model, swiv_formats::debris::HIT).to_vec();
                self.throw_debris(pos, &chips, 1, 1);
            }
            return;
        }
        let (pos, big, score, obj) = (e.pos, e.radius > (40 << MODEL_SHIFT), e.score, e.objective);
        if is_scenery(e) {
            // Scenery is not removed: it burns and stays as a wreck.
            e.wrecked = true;
            e.timer = 0;
            e.objective = None;
            e.top_model = None;
            e.hit_flash = 0;
        } else {
            e.alive = false;
        }
        let (tree, model, drop) = (is_tree(e.class), e.model, e.drop.take());
        self.score += score;
        let thrown = self.debris.get(model, swiv_formats::debris::DESTROYED).to_vec();
        if self.entities[i].wrecked {
            // What is left standing: one of the model's remains (rubble, a stump), picked
            // per object, swapped in behind the explosion.
            let remains: Vec<i32> = self.debris.get(model, swiv_formats::debris::REMAINS).iter().copied().filter(|m| self.model_info.contains_key(m)).collect();
            if !remains.is_empty() {
                let pick = (((pos[0] >> 8) * 73 + (pos[2] >> 8) * 151) & 0xffff) as usize % remains.len();
                let (radius, y_min) = self.info(remains[pick]);
                let e = &mut self.entities[i];
                e.pos[1] += e.y_min - y_min;
                (e.model, e.radius, e.y_min, e.remains) = (remains[pick], radius, y_min, true);
            }
        }
        if tree {
            self.events.push(Event::Explosion { big: false });
            self.throw_debris(pos, &thrown, 6, 1);
        } else if thrown.is_empty() {
            self.explode(pos, big);
        } else {
            self.explode_with(pos, big, &thrown);
        }
        if let Some(code) = drop {
            self.spawn_drop(i, code);
        }
        if let Some(g) = obj {
            let left = &mut self.objectives_left[g as usize];
            *left = left.saturating_sub(1);
            let done = *left == 0;
            self.objective_focus = Some(g);
            if done {
                self.events.push(Event::ObjectiveDone(g));
                if self.current_objective().is_none() && self.phase == Phase::Playing {
                    self.phase = Phase::Complete;
                    self.events.push(Event::LevelComplete);
                }
            }
        }
    }

    /// A shot-up building smokes from its roof, more often the more damaged it is.
    fn smoke_damaged(&mut self, i: usize) {
        let e = &self.entities[i];
        let damage = 256 - 256 * e.health.max(0) / e.max_health.max(1);
        let every = (36 - damage * 30 / 256).max(4);
        if self.tick % every as u64 != (i as u64 % every as u64) {
            return;
        }
        let (pos, radius) = (e.pos, e.radius);
        let top = self.model_top.get(&e.model).copied().unwrap_or(radius);
        let (x, z) = (pos[0] + self.rand_range(-radius / 3, radius / 3), pos[2] + self.rand_range(-radius / 3, radius / 3));
        let drift = self.rand_range(-50, 50);
        self.effects.push(Effect { pos: [x, pos[1] + top, z], vel: [drift, 240, drift / 2], age: 0, life: 40, model: SPRITE_SMOKE, size: 1, grow: 12, spin: 0, gravity: false, cap_y: 0 });
    }

    /// Smoke and flames from wrecked scenery (see [`Entity::wrecked`]).
    fn update_wreck(&mut self, i: usize) {
        let e = &mut self.entities[i];
        e.timer += 1;
        let (t, pos, radius, tree) = (e.timer, e.pos, e.radius, is_tree(e.class));
        let top = self.model_top.get(&e.model).copied().unwrap_or(radius);
        let jitter = |w: &mut World, r: i32| [pos[0] + w.rand_range(-r, r), pos[2] + w.rand_range(-r, r)];
        if tree {
            if t <= TREE_COLUMN_TICKS {
                let ground = pos[1] + self.entities[i].y_min;
                self.tree_mushroom(t, [pos[0], ground, pos[2]]);
            } else if t <= TREE_BURN_TICKS && t % 5 == 0 {
                let [x, z] = jitter(self, radius / 4);
                let y = pos[1] + top * self.rand_range(30, 90) / 100;
                self.effects.push(Effect { pos: [x, y, z], vel: [0, 350, 0], age: 0, life: 12, model: SPRITE_FIREBALL, size: 1, grow: 10, spin: 0, gravity: false, cap_y: 0 });
            }
            return;
        }
        let roof = pos[1] + top * RUBBLE_SQUASH / 256;
        if t <= WRECK_SMOKE_TICKS && t % 9 == 0 {
            let [x, z] = jitter(self, radius / 3);
            let drift = self.rand_range(-60, 60);
            self.effects.push(Effect { pos: [x, roof, z], vel: [drift, 260, drift / 2], age: 0, life: 50, model: SPRITE_SMOKE, size: 1, grow: 14, spin: 0, gravity: false, cap_y: 0 });
        }
        if t <= WRECK_FIRE_TICKS && t % 6 == 0 {
            let [x, z] = jitter(self, radius / 2);
            self.effects.push(Effect { pos: [x, roof, z], vel: [0, 200, 0], age: 0, life: 10, model: SPRITE_FIREBALL, size: 1, grow: 6, spin: 0, gravity: false, cap_y: 0 });
        }
    }

    /// A burning tree goes up as a mushroom of fire, like the original: a flare at the foot,
    /// then a stream of fireballs that shoot up the stalk, slow near the top and roll out
    /// sideways into the cap (see `Effect::cap_y`). They grow as they age, so young puffs
    /// make a slim stalk and older ones a wide cap. `foot` is where the trunk meets the
    /// ground. Sized from `TREE_HEIGHT`, not the model: by now the tree has been swapped for
    /// its stump. Called each tick `t` of the first `TREE_COLUMN_TICKS`.
    fn tree_mushroom(&mut self, t: i32, foot: [i32; 3]) {
        const H: i32 = TREE_HEIGHT;
        if t == 1 {
            for _ in 0..3 {
                let (dx, dz) = (self.rand_range(-H / 5, H / 5), self.rand_range(-H / 5, H / 5));
                self.effects.push(Effect { pos: [foot[0] + dx, foot[1] + H / 8, foot[2] + dz], vel: [0, H / 60, 0], age: 0, life: 12, model: SPRITE_EXPLOSION, size: 1, grow: 18, spin: 0, gravity: false, cap_y: 0 });
            }
        }
        if t <= 36 {
            for _ in 0..1 + (t % 3 == 0) as i32 {
                let a = self.rand_range(0, 512);
                let drift = H / 80;
                let (dx, dz) = (self.rand_range(-H / 14, H / 14), self.rand_range(-H / 14, H / 14));
                let cap_y = foot[1] + H * 4 / 3 + self.rand_range(-H / 10, H / 10);
                self.effects.push(Effect {
                    pos: [foot[0] + dx, foot[1] + H / 8, foot[2] + dz],
                    vel: [sin(a) * drift / 256, H / 16, cos(a) * drift / 256],
                    age: 0,
                    life: 40,
                    model: SPRITE_EXPLOSION,
                    size: 1,
                    grow: 6,
                    spin: 0,
                    gravity: false,
                    cap_y,
                });
            }
        }
    }

    /// A small burst where a gun pulse hits the ground or a target.
    fn impact(&mut self, pos: [i32; 3]) {
        self.effects.push(Effect { pos, vel: [0, 120, 0], age: 0, life: 7, model: SPRITE_IMPACT, size: 1, grow: 50, spin: 0, gravity: false, cap_y: 0 });
    }

    fn explode(&mut self, pos: [i32; 3], big: bool) {
        self.explode_with(pos, big, &DEBRIS_MODELS);
    }

    /// Throw `count` pieces picked from `models`, tumbling under gravity.
    fn throw_debris(&mut self, pos: [i32; 3], models: &[i32], count: usize, size: i32) {
        if models.is_empty() {
            return;
        }
        for _ in 0..count {
            let a = self.rand_range(0, 512);
            let sp = self.rand_range(300, 1200) * size;
            let m = models[(self.rand() as usize) % models.len()];
            let up = self.rand_range(600, 1600);
            let spin = self.rand_range(-20, 20);
            self.effects.push(Effect { pos, vel: [sin(a) * sp / 256, up, cos(a) * sp / 256], age: 0, life: 60, model: m, size: 1, grow: 0, spin, gravity: true, cap_y: 0 });
        }
    }

    /// A pickup left in a destroyed building's ruins: it floats there until winched aboard.
    fn spawn_drop(&mut self, ruin: usize, code: i32) {
        let e = &self.entities[ruin];
        let item = pickup_model(code);
        if !self.model_info.contains_key(&item) {
            return;
        }
        let top = self.model_top.get(&e.model).copied().unwrap_or(0);
        let (_, item_y_min) = self.info(item);
        let pos = e.pos;
        let item_pos = [pos[0], pos[1] + top - item_y_min + (8 << MODEL_SHIFT), pos[2]];
        self.entities.push(Entity {
            class: 7000,
            brain: Brain::Pickup,
            model: 0, // no platform (no model has id 0): the collectable floats over the rubble
            top_model: Some(item),
            pos,
            vel: [0; 3],
            yaw: 0,
            top_yaw: 0,
            health: 1,
            max_health: 1,
            radius: 4 << MODEL_SHIFT,
            y_min: 0,
            objective: None,
            alive: true,
            hostile: false,
            cooldown: 0,
            timer: 0,
            pickup: code,
            hit_flash: 0,
            score: 0,
            awake: false,
            item_pos,
            beaming: false,
            wrecked: false,
            remains: false,
            drop: None,
        });
    }

    fn explode_with(&mut self, pos: [i32; 3], big: bool, pieces: &[i32]) {
        self.events.push(Event::Explosion { big });
        let size = if big { 2 } else { 1 };
        for k in 0..4 {
            let jitter = [self.rand_range(-1500, 1500), self.rand_range(0, 1200), self.rand_range(-1500, 1500)];
            self.effects.push(Effect {
                pos: [pos[0] + jitter[0] * size, pos[1] + jitter[1] * size, pos[2] + jitter[2] * size],
                vel: [0, 150 + 120 * k, 0],
                age: -k * 2,
                life: 16,
                model: SPRITE_EXPLOSION,
                size,
                grow: 22,
                spin: 0,
                gravity: false,
                cap_y: 0,
            });
        }
        self.throw_debris(pos, pieces, if big { 10 } else { 5 }, size);
    }

    fn update_entities(&mut self) {
        let p = self.player.pos;
        let playing = self.phase == Phase::Playing;
        let mut new_entities = Vec::new();
        for i in 0..self.entities.len() {
            if !self.entities[i].alive {
                continue;
            }
            let e = &self.entities[i];
            if e.hit_flash > 0 {
                self.entities[i].hit_flash -= 1;
            }
            let e = &self.entities[i];
            let d = [wrap(p[0] - e.pos[0]), p[1] - e.pos[1], wrap(p[2] - e.pos[2])];
            let dist = ((d[0] as f64).hypot(d[2] as f64)) as i32;
            let cells = dist >> CELL_SHIFT;
            if matches!(e.brain, Brain::Aircraft | Brain::Drone) && !e.awake {
                if !(playing && cells < AIR_WAKE_CELLS) {
                    continue; // parked until the player comes into view
                }
                self.entities[i].awake = true;
            } else if cells > 60 && !matches!(e.brain, Brain::Aircraft) {
                continue; // dormant outside the active radius, like the original's draw/AI window
            }
            let e = &self.entities[i];
            let to_player = trig::atan2(d[0], d[2]);
            match e.brain {
                Brain::Static => {
                    let e = &self.entities[i];
                    if e.wrecked {
                        self.update_wreck(i);
                    } else if e.health < e.max_health && is_scenery(e) && !is_tree(e.class) {
                        self.smoke_damaged(i);
                    }
                }
                Brain::Pickup => self.update_pickup(i, playing && cells == 0 && d[1].abs() < (40 << 8 << 2)),
                Brain::Turret => {
                    let e = &mut self.entities[i];
                    let td = trig::delta(e.top_yaw, to_player).clamp(-4, 4);
                    e.top_yaw = (e.top_yaw + td) & trig::ANGLE_MASK;
                    if e.top_model.is_none() {
                        e.yaw = e.top_yaw;
                    }
                    if e.cooldown > 0 {
                        e.cooldown -= 1;
                    } else if playing && cells < 28 && td.abs() < 4 {
                        e.cooldown = 50;
                        self.enemy_fire(i, 7000, 8);
                    }
                }
                Brain::Tank | Brain::Boat => {
                    let boat = e.brain == Brain::Boat;
                    let chase = cells < 30 && playing;
                    let e = &mut self.entities[i];
                    e.timer -= 1;
                    let want = if chase && cells > 6 { to_player } else { e.yaw };
                    e.yaw = (e.yaw + trig::delta(e.yaw, want).clamp(-2, 2)) & trig::ANGLE_MASK;
                    let speed = if chase && cells > 6 { 500 } else if e.timer > 0 { 250 } else { 0 };
                    let nx = e.pos[0] + sin(e.yaw) * speed / 256;
                    let nz = e.pos[2] + cos(e.yaw) * speed / 256;
                    let ok = self.terrain.is_water(nx, nz) == boat;
                    let e = &mut self.entities[i];
                    if ok {
                        e.pos[0] = nx;
                        e.pos[2] = nz;
                    } else {
                        e.yaw = (e.yaw + 128) & trig::ANGLE_MASK;
                    }
                    if e.timer < -90 {
                        e.timer = 120;
                    }
                    let g = self.terrain.height(e.pos[0], e.pos[2]);
                    let e = &mut self.entities[i];
                    e.pos[1] = g - e.y_min;
                    let td = trig::delta(e.top_yaw, to_player).clamp(-5, 5);
                    e.top_yaw = (e.top_yaw + td) & trig::ANGLE_MASK;
                    if e.cooldown > 0 {
                        e.cooldown -= 1;
                    } else if playing && cells < 22 && td.abs() < 5 {
                        e.cooldown = 70;
                        self.enemy_fire(i, 6000, 10);
                    }
                }
                Brain::Aircraft | Brain::Drone => {
                    let drone = e.brain == Brain::Drone;
                    let e = &mut self.entities[i];
                    let turn = if drone { 3 } else { 4 };
                    let want = if playing { to_player } else { e.yaw + 1 };
                    e.yaw = (e.yaw + trig::delta(e.yaw, want).clamp(-turn, turn)) & trig::ANGLE_MASK;
                    // A little slower than at first, so they no longer easily outrun the player's turn.
                    let speed = if drone { if cells > 8 { 1600 } else { 0 } } else { 3200 };
                    e.pos[0] = (e.pos[0] + sin(e.yaw) * speed / 256).rem_euclid(WORLD_SIZE);
                    e.pos[2] = (e.pos[2] + cos(e.yaw) * speed / 256).rem_euclid(WORLD_SIZE);
                    let g = self.terrain.height(e.pos[0], e.pos[2]);
                    let e = &mut self.entities[i];
                    let target_y = g + ((crate::heli::HOVER + if drone { 0 } else { 30 }) << 8);
                    e.pos[1] += (target_y - e.pos[1]) / 8;
                    e.top_yaw = e.yaw;
                    if e.cooldown > 0 {
                        e.cooldown -= 1;
                    } else if playing && cells < 20 && trig::delta(e.yaw, to_player).abs() < 24 {
                        e.cooldown = if drone { 40 } else { 30 };
                        self.enemy_fire(i, 9000, 8);
                    }
                }
                Brain::Spawner { spawns_aircraft } => {
                    let e = &mut self.entities[i];
                    e.top_yaw = (e.top_yaw + 4) & trig::ANGLE_MASK;
                    e.timer += 1;
                    if playing && cells < 40 && e.timer > 20 * TICK_HZ as i32 {
                        e.timer = 0;
                        let pos = e.pos;
                        let yaw = e.yaw;
                        let (model, brain) = if spawns_aircraft { (102, Brain::Aircraft) } else { (200, Brain::Tank) };
                        new_entities.push((pos, yaw, model, brain));
                    }
                }
            }
        }
        let live = self.entities.iter().filter(|e| e.alive && e.class < 0).count();
        for (pos, yaw, model, brain) in new_entities {
            if live > 24 {
                break;
            }
            let (radius, y_min) = self.info(model);
            self.entities.push(Entity {
                class: -1,
                brain,
                model,
                top_model: if brain == Brain::Tank { Some(201) } else { None },
                pos: [pos[0] + (sin(yaw) << 8), pos[1], pos[2] + (cos(yaw) << 8)],
                vel: [0; 3],
                yaw,
                top_yaw: yaw,
                health: 30,
                max_health: 30,
                radius,
                y_min,
                objective: None,
                alive: true,
                hostile: true,
                cooldown: 60,
                timer: 0,
                pickup: 0,
                hit_flash: 0,
                score: 250,
                awake: true,
                item_pos: [0; 3],
                beaming: false,
                wrecked: false,
                remains: false,
                drop: None,
            });
        }
    }

    fn enemy_fire(&mut self, i: usize, speed: i32, damage: i32) {
        let e = &self.entities[i];
        let p = self.player.pos;
        let from = [e.pos[0], e.pos[1] - e.y_min, e.pos[2]];
        let d = [wrap(p[0] - from[0]), p[1] - from[1], wrap(p[2] - from[2])];
        let len = ((d[0] as f64).powi(2) + (d[1] as f64).powi(2) + (d[2] as f64).powi(2)).sqrt().max(1.0);
        // Lead the target a little.
        let t = len / speed as f64;
        let aim = [d[0] as f64 + self.player.vel[0] as f64 * t, d[1] as f64, d[2] as f64 + self.player.vel[2] as f64 * t];
        let l2 = (aim[0].powi(2) + aim[1].powi(2) + aim[2].powi(2)).sqrt().max(1.0);
        let vel = aim.map(|c| (c / l2 * speed as f64) as i32);
        self.projectiles.push(Projectile {
            pos: from,
            vel,
            from_player: false,
            damage,
            life: 90,
            model: SPRITE_FIREBALL,
            target: None,
        });
        self.events.push(Event::EnemyShot);
    }

    /// The collectable spins above its platform. Once the craft is over it, a tractor beam
    /// winches it up; the extra weight drags the craft down until it is aboard.
    fn update_pickup(&mut self, i: usize, player_over: bool) {
        let p = self.player.pos;
        let e = &mut self.entities[i];
        e.top_yaw = (e.top_yaw + 6) & trig::ANGLE_MASK;
        if !e.beaming {
            if player_over && self.phase == Phase::Playing {
                e.beaming = true;
                e.timer = 0;
                self.events.push(Event::PickupStart);
            }
            return;
        }
        e.timer += 1;
        let hold = [p[0], p[1] - (10 << MODEL_SHIFT), p[2]];
        let left = (PICKUP_BEAM_TICKS - e.timer).max(1);
        for c in 0..3 {
            let d = if c == 1 { hold[c] - e.item_pos[c] } else { wrap(hold[c] - e.item_pos[c]) };
            e.item_pos[c] += d / left;
        }
        e.item_pos[0] = e.item_pos[0].rem_euclid(WORLD_SIZE);
        e.item_pos[2] = e.item_pos[2].rem_euclid(WORLD_SIZE);
        if e.timer >= PICKUP_BEAM_TICKS {
            self.collect_pickup(i);
        } else {
            self.player.vel[1] -= PICKUP_LOAD;
        }
    }

    fn collect_pickup(&mut self, i: usize) {
        // The collectable goes aboard; its platform stays behind as scenery.
        let e = &mut self.entities[i];
        let code = e.pickup;
        e.brain = Brain::Static;
        e.top_model = None;
        e.beaming = false;
        match code {
            0..=19 => {
                let k = code as usize;
                self.ammo[k] = (self.ammo[k] + SPECIAL_AMMO).min(99);
                self.special = Some(k);
            }
            PICKUP_HEALTH_10 => self.health = (self.health + 10).min(100),
            PICKUP_HEALTH_25 => self.health = (self.health + 25).min(100),
            PICKUP_HEALTH_MEGA => self.health = 100,
            c if PICKUP_POWER_UP.contains(&c) => self.weapon_level = (self.weapon_level + 1).min(3),
            PICKUP_SHIELD => self.shield = SHIELD_DAMAGE,
            // The buddy drones are not modelled yet.
            _ => self.score += 500,
        }
        self.events.push(Event::Pickup(code));
    }

    /// Tractor beams to draw: (collectable, craft) pairs.
    pub fn beams(&self) -> Vec<([i32; 3], [i32; 3])> {
        let p = self.player.pos;
        // The hoist comes out of the craft's belly (its lowest point is 12 units down).
        self.entities.iter().filter(|e| e.alive && e.beaming).map(|e| (e.item_pos, [p[0], p[1] - (10 << MODEL_SHIFT), p[2]])).collect()
    }

    fn update_projectiles(&mut self) {
        let mut k = 0;
        while k < self.projectiles.len() {
            let mut pr = self.projectiles[k].clone();
            if let Some(t) = pr.target.and_then(|t| self.entities.get(t)).filter(|e| e.alive) {
                let d = [wrap(t.pos[0] - pr.pos[0]), t.pos[1] - pr.pos[1], wrap(t.pos[2] - pr.pos[2])];
                let speed = ((pr.vel[0] as f64).powi(2) + (pr.vel[1] as f64).powi(2) + (pr.vel[2] as f64).powi(2)).sqrt();
                let len = ((d[0] as f64).powi(2) + (d[1] as f64).powi(2) + (d[2] as f64).powi(2)).sqrt().max(1.0);
                for c in 0..3 {
                    let want = d[c] as f64 / len * speed;
                    pr.vel[c] += ((want - pr.vel[c] as f64) / 4.0) as i32;
                }
            }
            let mut dead = false;
            // Sub-step so fast shots cannot tunnel through targets.
            for _ in 0..2 {
                for c in 0..3 {
                    pr.pos[c] += pr.vel[c] / 2;
                }
                pr.pos[0] = pr.pos[0].rem_euclid(WORLD_SIZE);
                pr.pos[2] = pr.pos[2].rem_euclid(WORLD_SIZE);
                if pr.pos[1] <= self.terrain.height(pr.pos[0], pr.pos[2]) {
                    if pr.damage >= 20 {
                        self.explode(pr.pos, false);
                    } else if pr.from_player {
                        self.impact(pr.pos);
                    }
                    dead = true;
                    break;
                }
                if pr.from_player {
                    if let Some(i) = self.hit_entity(&pr) {
                        self.impact(pr.pos);
                        self.hurt_entity(i, pr.damage);
                        dead = true;
                        break;
                    }
                } else if self.phase == Phase::Playing {
                    let p = self.player.pos;
                    let d = [wrap(p[0] - pr.pos[0]), p[1] - pr.pos[1], wrap(p[2] - pr.pos[2])];
                    let r = 40 << MODEL_SHIFT;
                    if d.iter().all(|c| c.abs() < r) && (d[0] as i64).pow(2) + (d[1] as i64).pow(2) + (d[2] as i64).pow(2) < (r as i64).pow(2) {
                        self.damage_player(pr.damage);
                        dead = true;
                        break;
                    }
                }
            }
            pr.life -= 1;
            if dead || pr.life <= 0 {
                self.projectiles.swap_remove(k);
            } else {
                self.projectiles[k] = pr;
                k += 1;
            }
        }
    }

    fn hit_entity(&self, pr: &Projectile) -> Option<usize> {
        for (i, e) in self.entities.iter().enumerate() {
            if !e.alive || e.wrecked || e.brain == Brain::Pickup {
                continue;
            }
            let r = e.radius.max(12 << MODEL_SHIFT);
            let d = [wrap(e.pos[0] - pr.pos[0]), e.pos[1] - pr.pos[1], wrap(e.pos[2] - pr.pos[2])];
            if d.iter().any(|c| c.abs() > r) {
                continue;
            }
            if (d[0] as i64).pow(2) + (d[1] as i64).pow(2) + (d[2] as i64).pow(2) < (r as i64).pow(2) {
                return Some(i);
            }
        }
        None
    }

    fn update_effects(&mut self) {
        for fx in &mut self.effects {
            fx.age += 1;
            for c in 0..3 {
                fx.pos[c] += fx.vel[c];
            }
            if fx.cap_y != 0 && fx.pos[1] > fx.cap_y - TREE_HEIGHT / 2 {
                // Nearing the cap: the climb bleeds off into an outward roll.
                fx.vel[1] = fx.vel[1] * 3 / 4 - TREE_HEIGHT / 600;
                let out = (fx.vel[0] as i64).pow(2) + (fx.vel[2] as i64).pow(2);
                if out < ((TREE_HEIGHT / 45) as i64).pow(2) {
                    fx.vel[0] = fx.vel[0] * 3 / 2;
                    fx.vel[2] = fx.vel[2] * 3 / 2;
                }
            }
            if fx.gravity {
                fx.vel[1] -= 90;
                let g = self.terrain.height(fx.pos[0], fx.pos[2]);
                if fx.pos[1] < g {
                    fx.pos[1] = g;
                    fx.vel = [fx.vel[0] / 2, -fx.vel[1] / 3, fx.vel[2] / 2];
                }
            }
        }
        self.effects.retain(|f| f.age < f.life);
    }

    /// Everything to draw this frame (terrain is drawn separately).
    pub fn instances(&self, out: &mut Vec<Instance>) {
        out.clear();
        let mk = |model, pos, yaw, scale, flash| Instance { model, pos, yaw, pitch: 0, roll: 0, scale, flash, squash: 256, charred: false, alpha: 255 };
        for e in self.entities.iter().filter(|e| e.alive) {
            let mut body = mk(e.model, e.pos, e.yaw, 256, e.hit_flash > 0);
            if e.wrecked && !e.remains && !is_tree(e.class) {
                body.charred = true;
                body.squash = RUBBLE_SQUASH;
                // Collapsed unevenly: a tilted wedge rather than a neat slab.
                body.pitch = 14;
                body.roll = -10;
            }
            out.push(body);
            if let Some(t) = e.top_model {
                let at = if e.brain == Brain::Pickup { e.item_pos } else { e.pos };
                out.push(mk(t, at, e.top_yaw, 256, e.hit_flash > 0));
            }
        }
        if self.phase == Phase::Playing {
            let (pitch, roll) = self.player.attitude();
            out.push(Instance {
                model: PLAYER_MODEL,
                pos: self.player.pos,
                yaw: self.player.yaw,
                pitch,
                roll,
                scale: 256,
                flash: false,
                squash: 256,
                charred: false,
                alpha: 255,
            });
            if self.shield > 0 {
                // The shield model is already a ring of pods around its origin: centre it on
                // the craft and spin it in place.
                out.push(mk(SHIELD_MODEL, self.player.pos, self.shield_angle, 256, false));
            }
        }
        if let Some(t) = self.target.and_then(|i| self.entities.get(i)).filter(|e| e.alive) {
            // Lock-on ring sized to the target; scale 256 = 12 model units across.
            let scale = (t.radius / 12).max(220);
            out.push(mk(SPRITE_TARGET, [t.pos[0], t.pos[1] + (4 << MODEL_SHIFT), t.pos[2]], 0, scale, false));
        }
        for p in &self.projectiles {
            let scale = if p.model < 0 { 256 } else if p.from_player { 160 } else { 200 };
            out.push(mk(p.model, p.pos, trig::atan2(p.vel[0], p.vel[2]), scale, false));
        }
        for f in &self.effects {
            if f.age < 0 {
                continue;
            }
            let scale = if f.gravity { 256 } else { (256 + f.age * f.grow) * f.size };
            let mut i = mk(f.model, f.pos, f.age * f.spin, scale, false);
            i.pitch = f.age * f.spin;
            if f.model < 0 {
                // Mushroom gas burns a little dimmer than a blast, holding that until it
                // fades over the last third of its life.
                let (k, max) = if f.cap_y != 0 { (3, MUSHROOM_BRIGHTNESS) } else { (1, 255) };
                i.alpha = (255 * k * (f.life - f.age) / f.life.max(1)).clamp(0, max) as u8;
            }
            out.push(i);
        }
    }
}
