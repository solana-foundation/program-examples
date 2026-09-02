use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::read_price;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (reading a Pyth price update), so
/// there is no leading discriminator byte and the instruction carries no data.
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: ReadPrice");
    read_price(accounts)
}
