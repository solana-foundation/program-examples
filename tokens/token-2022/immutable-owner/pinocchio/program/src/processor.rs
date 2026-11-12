use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::create_token_account;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (creating a Token-2022 token
/// account that carries the `ImmutableOwner` extension), so there is no leading
/// discriminator byte and the instruction carries no data, the account's owner
/// is supplied as an account (see `create_token_account`).
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: CreateTokenAccount");
    create_token_account(accounts)
}
