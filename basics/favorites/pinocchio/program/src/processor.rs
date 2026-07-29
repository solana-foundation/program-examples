use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::instructions::{create_pda::*, get_pda::*};
pub use crate::state::Favorites;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, ix_data) = instruction_data.split_first().unwrap();

    match discriminator {
        1 => create_pda(program_id, accounts, ix_data),
        2 => get_pda(program_id, accounts, ix_data),
        _ => Err(ProgramError::InvalidInstructionData),
    }?;

    Ok(())
}
