// Objects

pub struct Ride {
    pub name: &'static str,
    pub upside_down: bool,
    pub tickets: u32,
    pub min_height: u32,
}

pub const RIDES: &[Ride] = &[
    Ride { name: "Tilt-a-Whirl", upside_down: false, tickets: 3, min_height: 48 },
    Ride { name: "Scrambler", upside_down: false, tickets: 3, min_height: 48 },
    Ride { name: "Ferris Wheel", upside_down: false, tickets: 5, min_height: 55 },
    Ride { name: "Zero Gravity", upside_down: true, tickets: 5, min_height: 60 },
];
