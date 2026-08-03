use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{make_offer, take_offer};

/// Dispatches an instruction based on its leading discriminator byte.
///
/// Instruction data layout: `[discriminator: u8, ..args]`
///   - `0` -> MakeOffer (args: `[id: u64 (LE), token_a_offered_amount: u64 (LE),
///                              token_b_wanted_amount: u64 (LE), bump: u8]`)
///   - `1` -> TakeOffer (no args)
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, args) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        0 => {
            log!("Instruction: MakeOffer");
            make_offer(program_id, accounts, args)
        }
        1 => {
            log!("Instruction: TakeOffer");
            take_offer(program_id, accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
