use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{eat_food, get_on_ride, play_game};

// For processing everything at the entrypoint
//
// Instruction data layout (matches the native borsh layout):
//   - name:           u32 LE length + utf-8 bytes
//   - height:         u32 LE
//   - ticket_count:   u32 LE
//   - attraction:     u32 LE length + utf-8 bytes ("ride" | "game" | "food")
//   - attraction_name: u32 LE length + utf-8 bytes

pub fn process_instruction(
    _program_id: &Address,
    _accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let mut cursor = 0;
    let name = read_str(instruction_data, &mut cursor)?;
    let height = read_u32(instruction_data, &mut cursor)?;
    let ticket_count = read_u32(instruction_data, &mut cursor)?;
    let attraction = read_str(instruction_data, &mut cursor)?;
    let attraction_name = read_str(instruction_data, &mut cursor)?;

    log!("Welcome to the carnival, {}!", name);

    match attraction {
        "ride" => get_on_ride::get_on_ride(get_on_ride::GetOnRideInstructionData {
            rider_name: name,
            rider_height: height,
            rider_ticket_count: ticket_count,
            ride: attraction_name,
        }),
        "game" => play_game::play_game(play_game::PlayGameInstructionData {
            gamer_name: name,
            gamer_ticket_count: ticket_count,
            game: attraction_name,
        }),
        "food" => eat_food::eat_food(eat_food::EatFoodInstructionData {
            eater_name: name,
            eater_ticket_count: ticket_count,
            food_stand: attraction_name,
        }),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn read_u32(data: &[u8], cursor: &mut usize) -> Result<u32, ProgramError> {
    let end = cursor.checked_add(4).ok_or(ProgramError::InvalidInstructionData)?;
    if end > data.len() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let bytes: [u8; 4] = data[*cursor..end].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    *cursor = end;
    Ok(u32::from_le_bytes(bytes))
}

fn read_str<'a>(data: &'a [u8], cursor: &mut usize) -> Result<&'a str, ProgramError> {
    let len = read_u32(data, cursor)? as usize;
    let end = cursor.checked_add(len).ok_or(ProgramError::InvalidInstructionData)?;
    if end > data.len() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let s = core::str::from_utf8(&data[*cursor..end]).map_err(|_| ProgramError::InvalidInstructionData)?;
    *cursor = end;
    Ok(s)
}
