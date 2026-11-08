use swiv_core::trig::{cos, sin};
use swiv_core::world::{wrap, Brain};
use swiv_core::{Event, Input, World};
use swiv_formats::Level;

fn level(name: &str) -> Option<Level> {
    let dir = std::path::PathBuf::from(std::env::var("SWIV_DATA").ok()?);
    Some(Level::parse(std::fs::read(dir.join(name)).ok()?).unwrap())
}

fn hash(w: &World) -> u64 {
    let p = &w.player;
    let mut h = 1469598103934665603u64;
    for v in p.pos.iter().chain(p.vel.iter()).chain([p.yaw, w.score, w.health].iter()) {
        h = (h ^ *v as u32 as u64).wrapping_mul(1099511628211);
    }
    h
}

#[test]
fn deterministic_replay_and_sane_flight() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let script = |t: u64| Input { forward: t % 200 < 150, left: t % 90 < 30, fire: t % 7 < 4, ..Default::default() };
    let run = || {
        let mut w = World::new(&l);
        for t in 0..1500 {
            w.step(&script(t));
        }
        w
    };
    let (a, b) = (run(), run());
    assert_eq!(hash(&a), hash(&b), "simulation must be deterministic");
    // Hovering: the craft should stay above the ground and near hover height.
    let mut w = World::new(&l);
    for _ in 0..300 {
        w.step(&Input::default());
    }
    let g = w.terrain.height(w.player.pos[0], w.player.pos[2]);
    let above = (w.player.pos[1] - g) >> 8;
    assert!((60..=100).contains(&above), "hover height {above}");
    // Flying forward reaches the decoded terminal speed (~4800 units/tick).
    for _ in 0..200 {
        w.step(&Input { forward: true, ..Default::default() });
    }
    let v = w.player.vel;
    let speed = ((v[0] as f64).powi(2) + (v[2] as f64).powi(2)).sqrt();
    assert!((4000.0..5600.0).contains(&speed), "speed {speed}");
}

#[test]
fn aircraft_wait_until_the_player_is_close() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let start: Vec<_> = w.entities.iter().map(|e| e.pos).collect();
    for _ in 0..90 {
        w.step(&Input::default());
    }
    let p = w.player.pos;
    for (e, s) in w.entities.iter().zip(&start) {
        if !matches!(e.brain, Brain::Aircraft | Brain::Drone) {
            continue;
        }
        let cells = ((wrap(s[0] - p[0]) as f64).hypot(wrap(s[2] - p[2]) as f64) as i32) >> 14;
        if cells > 20 {
            assert_eq!([e.pos[0], e.pos[2]], [s[0], s[2]], "aircraft {cells} cells away should not move yet");
        }
    }
}

#[test]
fn auto_target_prefers_aircraft_over_nearer_ground_targets() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let air = w.entities.iter().position(|e| e.brain == Brain::Aircraft).expect("an aircraft");
    let ground = w.entities.iter().position(|e| e.hostile && e.brain == Brain::Turret).expect("a turret");
    for (i, e) in w.entities.iter_mut().enumerate() {
        e.alive = i == air || i == ground;
    }
    let (p, yaw) = (w.player.pos, w.player.yaw);
    let ahead = |cells: i32| [p[0] + sin(yaw) * (cells << 6), p[1], p[2] + cos(yaw) * (cells << 6)];
    w.entities[ground].pos = ahead(4);
    w.entities[air].pos = ahead(10);
    w.entities[air].awake = true;
    for _ in 0..4 {
        w.step(&Input::default());
    }
    assert_eq!(w.target, Some(air));
    // With no aircraft in the cone the nearest ground target is picked.
    w.entities[air].alive = false;
    for _ in 0..4 {
        w.step(&Input::default());
    }
    assert_eq!(w.target, Some(ground));
}

#[test]
fn pickups_are_winched_aboard_and_weigh_the_craft_down() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    for e in w.entities.iter().filter(|e| e.brain == Brain::Pickup) {
        // Platforms rest on the highest ground they cover, so slopes never swallow them.
        // The pads are flat quads: check the visible terrain mesh across their whole span.
        let r = 35 << 8;
        for (dx, dz) in [(0, 0), (-r, -r), (r, -r), (-r, r), (r, r), (0, r), (r, 0), (0, -r), (-r, 0)] {
            assert!(e.pos[1] + e.y_min > w.terrain.mesh_height(e.pos[0] + dx, e.pos[2] + dz), "platform sunk into the ground");
        }
        assert!(e.item_pos[1] > e.pos[1], "collectable floats above its platform");
    }
    let i = w.entities.iter().position(|e| e.brain == Brain::Pickup && e.pickup == 0).expect("a Missiles pickup");
    let (pos, yaw) = (w.entities[i].pos, w.entities[i].yaw);
    for _ in 0..120 {
        w.step(&Input::default());
    }
    w.player = swiv_core::heli::Heli::new([pos[0], w.player.pos[1], pos[2]], 0);
    // Settle into the hover over the pad, then measure the sag while the beam pulls.
    let g = w.terrain.height(pos[0], pos[2]);
    w.player.pos[1] = g + (swiv_core::heli::HOVER << 8);
    let start = w.player.pos[1];
    let mut lowest = start;
    let mut got = None;
    let mut started = None;
    for _ in 0..60 {
        w.step(&Input::default());
        if w.events.contains(&Event::PickupStart) {
            started = Some(w.tick);
        }
        lowest = lowest.min(w.player.pos[1]);
        if let Some(c) = w.events.iter().find_map(|e| if let Event::Pickup(c) = e { Some(*c) } else { None }) {
            got = Some((c, w.tick));
            break;
        }
        assert_eq!(w.entities[i].yaw, yaw, "the platform stays still");
    }
    for _ in 0..30 {
        w.step(&Input::default());
        assert!(!w.events.iter().any(|e| matches!(e, Event::Pickup(_))), "collected only once");
    }
    let (code, aboard) = got.expect("Missiles came aboard");
    assert_eq!(code, 0);
    // The winch sound (1.58 s) starts with the beam and ends as the pickup comes aboard.
    assert_eq!(aboard - started.expect("beam started"), 48);
    assert!(w.entities[i].alive && w.entities[i].brain == Brain::Static && w.entities[i].top_model.is_none(), "platform stays, empty");
    assert_eq!((w.special, w.ammo[0]), (Some(0), 6));
    assert!(start - lowest > 8 << 8, "craft dipped by {} units", (start - lowest) >> 8);
}

#[test]
fn destroyed_scenery_stays_as_a_smoking_wreck() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let near = |w: &World, e: &swiv_core::world::Entity| {
        let p = w.player.pos;
        ((wrap(e.pos[0] - p[0]) as f64).hypot(wrap(e.pos[2] - p[2]) as f64) as i32) >> 14
    };
    let building = w.entities.iter().position(|e| e.class == 2000 && e.brain == Brain::Static && near(&w, e) < 20).expect("a building nearby");
    let tree = w.entities.iter().position(|e| matches!(e.class, 2002 | 2003) && near(&w, e) < 20).expect("a tree nearby");
    let (original_building, building_radius) = (w.entities[building].model, w.entities[building].radius);
    for i in [building, tree] {
        w.hurt(i, 10_000);
        assert!(w.entities[i].alive && w.entities[i].wrecked, "wreck stays in the world");
    }
    let before = w.effects.len();
    for _ in 0..30 {
        w.step(&Input::default());
    }
    assert!(w.effects.len() > before, "wrecks smoke and burn");
    // The remains come from LEVEL_debris: rubble smaller than the house, one of six stumps.
    let ruin = &w.entities[building];
    assert!(l.debris.get(original_building, 0).contains(&ruin.model), "rubble model {}", ruin.model);
    assert!(ruin.radius < building_radius, "rubble is smaller than the house");
    assert!((761..=766).contains(&w.entities[tree].model), "stump model {}", w.entities[tree].model);
}

#[test]
fn some_buildings_leave_a_pickup_in_their_ruins() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let i = w.entities.iter().position(|e| e.class == 2000 && e.drop == Some(0)).expect("a building hiding Missiles");
    let before = w.entities.len();
    w.hurt(i, 10_000);
    let item = &w.entities[before];
    assert_eq!((item.brain, item.pickup, item.top_model), (Brain::Pickup, 0, Some(800)));
    assert!(item.item_pos[1] > w.entities[i].pos[1], "floats over the rubble");
}

#[test]
fn scenery_takes_the_hits_seen_in_the_footage() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let hits_to_wreck = |w: &mut World, i: usize| {
        let mut n = 0;
        while !w.entities[i].wrecked {
            w.hurt(i, swiv_core::world::PULSE_DAMAGE);
            n += 1;
        }
        n
    };
    let find = |w: &World, f: &dyn Fn(&swiv_core::world::Entity) -> bool| w.entities.iter().position(|e| f(e)).unwrap();
    let tree = find(&w, &|e| matches!(e.class, 2002 | 2003));
    let pylon = find(&w, &|e| e.class == 2000 && matches!(e.model, 552 | 553));
    let house = find(&w, &|e| e.class == 2000 && e.model == 500 && e.objective.is_none());
    assert_eq!(hits_to_wreck(&mut w, tree), 2);
    assert_eq!(hits_to_wreck(&mut w, pylon), 3);
    assert_eq!(hits_to_wreck(&mut w, house), 8);
}

#[test]
fn gun_fires_one_two_pause() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let mut shots = Vec::new();
    for _ in 0..90 {
        w.step(&Input { fire: true, ..Default::default() });
        if w.events.contains(&Event::PlayerShot) {
            shots.push(w.tick);
        }
    }
    let gaps: Vec<u64> = shots.windows(2).map(|p| p[1] - p[0]).collect();
    assert_eq!(gaps[..5], [7, 17, 7, 17, 7], "shots at {shots:?}");
}

#[test]
fn parked_aircraft_take_off_when_shot() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    for _ in 0..120 {
        w.step(&Input::default());
    }
    let air = w.entities.iter().position(|e| e.brain == Brain::Aircraft && e.alive).expect("an aircraft");
    let (p, yaw) = (w.player.pos, w.player.yaw);
    // Well outside the wake range, so it stays parked on its own.
    w.entities[air].pos = [p[0] + sin(yaw) * (30 << 6), p[1], p[2] + cos(yaw) * (30 << 6)];
    w.entities[air].awake = false;
    let parked = w.entities[air].pos;
    for _ in 0..10 {
        w.step(&Input::default());
    }
    assert_eq!(w.entities[air].pos, parked, "out of range it stays parked");
    w.hurt(air, 1);
    for _ in 0..10 {
        w.step(&Input::default());
    }
    assert!(w.entities[air].awake, "being shot wakes it");
    assert_ne!(w.entities[air].pos, parked, "and it takes off");
}

#[test]
fn no_target_lock_through_a_hill() {
    let Some(l) = level("TERRAN01.SLV") else { return eprintln!("SWIV_DATA not set") };
    let mut w = World::new(&l);
    let ground = w.entities.iter().position(|e| e.hostile && e.brain == Brain::Turret).expect("a turret");
    for (i, e) in w.entities.iter_mut().enumerate() {
        e.alive = i == ground;
    }
    let (p, yaw) = (w.player.pos, w.player.yaw);
    let at = [p[0] + sin(yaw) * (8 << 6), p[1], p[2] + cos(yaw) * (8 << 6)];
    let g = w.terrain.height(at[0], at[2]);
    w.entities[ground].pos = [at[0], g - w.entities[ground].y_min, at[2]];
    for _ in 0..4 {
        w.step(&Input::default());
    }
    assert_eq!(w.target, Some(ground), "visible: locked on");
    // Raise a wall of terrain between the craft and the turret.
    let mid = (p[0] + sin(yaw) * (4 << 6), p[2] + cos(yaw) * (4 << 6));
    let (cx, cz) = (mid.0 >> swiv_formats::level::CELL_SHIFT, mid.1 >> swiv_formats::level::CELL_SHIFT);
    for dz in -3..=3 {
        for dx in -3..=3 {
            w.terrain.hmap[(((cz + dz) & 511) << 9 | ((cx + dx) & 511)) as usize] = 255;
        }
    }
    for _ in 0..4 {
        w.step(&Input::default());
    }
    assert_eq!(w.target, None, "hidden behind the hill: no lock");
}
