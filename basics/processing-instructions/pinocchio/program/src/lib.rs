use pinocchio::{entrypoint, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

entrypoint!(process_instruction);

fn process_instruction(_program_id: &Address, _accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let name = core::str::from_utf8(&instruction_data[0..8]).map_err(|_| ProgramError::InvalidInstructionData)?;

    let height =
        u32::from_le_bytes(instruction_data[8..12].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);

    log!("Welcome to the park, {}!", name);
    if height > 5 {
        log!("You are tall enough to ride this ride. Congratulations.");
    } else {
        log!("You are NOT tall enough to ride this ride. Sorry mate.");
    };

    Ok(())
}

pub struct InstructionData {
    pub name: [u8; 8],
    pub height: u32,
}
