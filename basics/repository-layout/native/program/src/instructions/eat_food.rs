use solana_program::{entrypoint::ProgramResult, msg, program_error::ProgramError};

use crate::state::food;

// InstructionData Data

pub struct EatFoodInstructionData {
    pub eater_name: String,
    pub eater_ticket_count: u32,
    pub food_stand: String,
}

pub fn eat_food(ix: EatFoodInstructionData) -> ProgramResult {
    let food_stands_list = food::get_food_stands();

    for food_stand in food_stands_list.iter() {
        if ix.food_stand.eq(&food_stand.name) {
            msg!("Welcome to {}! What can I get you?", food_stand.name);

            if ix.eater_ticket_count < food_stand.tickets {
                msg!("  Sorry {}, our {} is {} tickets!", ix.eater_name, food_stand.food_type, food_stand.tickets);
            } else {
                msg!("  Enjoy your {}!", food_stand.food_type);
            };

            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData)
}
