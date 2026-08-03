// Objects

pub struct FoodStand {
    pub name: &'static str,
    pub food_type: &'static str,
    pub tickets: u32,
}

pub const FOOD_STANDS: &[FoodStand] = &[
    FoodStand { name: "Larry's Pizza", food_type: "pizza", tickets: 3 },
    FoodStand { name: "Taco Shack", food_type: "taco", tickets: 2 },
    FoodStand { name: "Dough Boy's", food_type: "fried dough", tickets: 1 },
];
