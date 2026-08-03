use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::create_token;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (creating a token), so — unlike
/// the `transfer-tokens` and `escrow` examples — there is no leading
/// discriminator byte. The whole instruction data is the Borsh-encoded
/// `CreateTokenArgs`, matching the wire format of the `native` version:
///
/// `[name: string, symbol: string, uri: string, decimals: u8]`
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: CreateToken");
    create_token(accounts, instruction_data)
}
