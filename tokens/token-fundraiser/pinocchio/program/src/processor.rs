use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{check_contributions, contribute, initialize, refund};

/// Dispatches an instruction based on its leading discriminator byte.
///
/// Instruction data layout: `[discriminator: u8, ..args]`
///   - `0` -> Initialize (args: `[amount: u64 (LE), duration: u16 (LE), bump: u8]`)
///   - `1` -> Contribute (args: `[amount: u64 (LE), contributor_bump: u8]`)
///   - `2` -> CheckContributions (no args)
///   - `3` -> Refund (no args)
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, args) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        0 => {
            log!("Instruction: Initialize");
            initialize(program_id, accounts, args)
        }
        1 => {
            log!("Instruction: Contribute");
            contribute(program_id, accounts, args)
        }
        2 => {
            log!("Instruction: CheckContributions");
            check_contributions(program_id, accounts, args)
        }
        3 => {
            log!("Instruction: Refund");
            refund(program_id, accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
