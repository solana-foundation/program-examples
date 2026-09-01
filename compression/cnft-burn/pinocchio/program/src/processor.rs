use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::burn_cnft;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (burning a compressed NFT through
/// mpl-bubblegum), so there is no leading discriminator byte — the whole
/// instruction data is the burn arguments.
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: BurnCnft");
    burn_cnft(accounts, instruction_data)
}
