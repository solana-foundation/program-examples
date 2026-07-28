// Objects

pub struct Ride {
    pub name: String,
    pub upside_down: bool,
    pub tickets: u32,
    pub min_height: u32,
}

impl Ride {
    pub fn new(name: String, upside_down: bool, tickets: u32, min_height: u32) -> Ride {
        Ride { name, upside_down, tickets, min_height }
    }
}

pub fn get_rides() -> Vec<Ride> {
    vec![
        Ride::new("Tilt-a-Whirl".to_string(), false, 3, 48),
        Ride::new("Scrambler".to_string(), false, 3, 48),
        Ride::new("Ferris Wheel".to_string(), false, 5, 55),
        Ride::new("Zero Gravity".to_string(), true, 5, 60),
    ]
}
