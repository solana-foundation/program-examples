use pinocchio::{error::ProgramError, ProgramResult};
use pinocchio_log::log;

use crate::state::food;

// InstructionData Data

pub struct EatFoodInstructionData<'a> {
    pub eater_name: &'a str,
    pub eater_ticket_count: u32,
    pub food_stand: &'a str,
}

pub fn eat_food(ix: EatFoodInstructionData) -> ProgramResult {
    for food_stand in food::FOOD_STANDS.iter() {
        if ix.food_stand == food_stand.name {
            log!("Welcome to {}! What can I get you?", food_stand.name);

            if ix.eater_ticket_count < food_stand.tickets {
                log!("  Sorry {}, our {} is {} tickets!", ix.eater_name, food_stand.food_type, food_stand.tickets);
            } else {
                log!("  Enjoy your {}!", food_stand.food_type);
            };

            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData)
}
