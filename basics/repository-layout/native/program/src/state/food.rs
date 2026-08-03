// Objects

pub struct FoodStand {
    pub name: String,
    pub food_type: String,
    pub tickets: u32,
}

impl FoodStand {
    pub fn new(name: String, food_type: String, tickets: u32) -> FoodStand {
        FoodStand { name, food_type, tickets }
    }
}

pub fn get_food_stands() -> Vec<FoodStand> {
    vec![
        FoodStand::new("Larry's Pizza".to_string(), "pizza".to_string(), 3),
        FoodStand::new("Taco Shack".to_string(), "taco".to_string(), 2),
        FoodStand::new("Dough Boy's".to_string(), "fried dough".to_string(), 1),
    ]
}
