use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::cpi_transfer;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (transferring tokens via CPI to
/// demonstrate the `CpiGuard` extension), so there is no leading discriminator
/// byte and the instruction carries no data — the amount is fixed at 1 token and
/// the decimals are read from the mint (see `cpi_transfer`).
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: CpiTransfer");
    cpi_transfer(accounts)
}
