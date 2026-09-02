use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{mint, verify};

/// Entrypoint for the program.
///
/// The two instructions are dispatched on a leading discriminator byte; the
/// rest of the data is the instruction's own arguments.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let Some((discriminator, args)) = instruction_data.split_first() else {
        return Err(ProgramError::InvalidInstructionData);
    };

    match discriminator {
        0 => {
            log!("Instruction: Mint");
            mint(program_id, accounts, args)
        }
        1 => {
            log!("Instruction: Verify");
            verify(program_id, accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
