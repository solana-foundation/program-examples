use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::create_mint;

/// Entrypoint for the program.
///
/// This example exposes a single instruction (creating a Token-2022 mint with
/// the `MetadataPointer` extension and on-chain `TokenMetadata`), so there is no
/// leading discriminator byte. The whole instruction data is the Borsh-encoded
/// metadata fields — `name: String`, `symbol: String`, `uri: String` — which are
/// forwarded verbatim to the `TokenMetadataInitialize` CPI (see `create_mint`).
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    log!("Instruction: CreateMint");
    create_mint(accounts, instruction_data)
}
