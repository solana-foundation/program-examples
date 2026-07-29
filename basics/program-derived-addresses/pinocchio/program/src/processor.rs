use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::instructions;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.split_first() {
        Some((0, instruction_data)) => instructions::create::create_page_visits(program_id, accounts, instruction_data),
        Some((1, _)) => instructions::increment::increment_page_visits(accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
