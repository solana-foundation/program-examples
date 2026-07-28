use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, program_error::ProgramError, pubkey::Pubkey,
};

use crate::instructions::{eat_food, get_on_ride, play_game};

// For processing everything at the entrypoint

entrypoint!(process_instruction);

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CarnivalInstructionData {
    pub name: String,
    pub height: u32,
    pub ticket_count: u32,
    pub attraction: String,
    pub attraction_name: String,
}

pub fn process_instruction(_program_id: &Pubkey, _accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let ix_data_object = CarnivalInstructionData::try_from_slice(instruction_data)?;

    msg!("Welcome to the carnival, {}!", ix_data_object.name);

    match ix_data_object.attraction.as_str() {
        "ride" => get_on_ride::get_on_ride(get_on_ride::GetOnRideInstructionData {
            rider_name: ix_data_object.name,
            rider_height: ix_data_object.height,
            rider_ticket_count: ix_data_object.ticket_count,
            ride: ix_data_object.attraction_name,
        }),
        "game" => play_game::play_game(play_game::PlayGameInstructionData {
            gamer_name: ix_data_object.name,
            gamer_ticket_count: ix_data_object.ticket_count,
            game: ix_data_object.attraction_name,
        }),
        "food" => eat_food::eat_food(eat_food::EatFoodInstructionData {
            eater_name: ix_data_object.name,
            eater_ticket_count: ix_data_object.ticket_count,
            food_stand: ix_data_object.attraction_name,
        }),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
