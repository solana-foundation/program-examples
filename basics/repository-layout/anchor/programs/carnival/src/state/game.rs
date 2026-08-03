// Objects

pub struct Game {
    pub name: String,
    pub tickets: u32,
    pub tries: u32,
    pub prize: String,
}

const DEFAULT_TICKETS_TO_PLAY: u32 = 3;

impl Game {
    pub fn new(name: String, tries: u32, prize: String) -> Game {
        Game { name, tickets: DEFAULT_TICKETS_TO_PLAY, tries, prize }
    }
}

pub fn get_games() -> Vec<Game> {
    vec![
        Game::new("Ring Toss".to_string(), 5, "teddy bear".to_string()),
        Game::new("I Got It!".to_string(), 12, "goldfish".to_string()),
        Game::new("Ladder Climb".to_string(), 1, "popcorn bucket".to_string()),
    ]
}
