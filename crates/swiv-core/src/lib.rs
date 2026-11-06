//! SWIV 3D game simulation: deterministic, fixed tick, no I/O.

pub mod heli;
pub mod trig;
pub mod world;

pub use heli::Input;
pub use world::{Event, Instance, Phase, World, TICK_HZ};
