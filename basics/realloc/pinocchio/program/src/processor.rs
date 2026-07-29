use crate::instructions::*;
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.split_first() {
        Some((0, data)) => create_address_info(program_id, accounts, data),
        Some((1, data)) => reallocate_without_zero_init(accounts, data),
        Some((2, data)) => reallocate_zero_init(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
