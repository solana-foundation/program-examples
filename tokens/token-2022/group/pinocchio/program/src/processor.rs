use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::initialize_group;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (creating a Token-2022 group mint),
/// so there is no leading discriminator byte and no instruction data — the mint
/// is a PDA the handler derives itself.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: InitializeGroup");
    initialize_group(program_id, accounts)
}
