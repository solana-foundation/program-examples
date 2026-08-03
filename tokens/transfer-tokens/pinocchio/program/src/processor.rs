use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{create_token, mint_tokens, transfer_tokens};

/// Dispatches an instruction based on its leading discriminator byte.
///
/// Instruction data layout: `[discriminator: u8, ..args]`
///   - `0` -> CreateToken    (args: `[decimals: u8]`)
///   - `1` -> MintTokens     (args: `[amount: u64 (LE)]`)
///   - `2` -> TransferTokens (args: `[amount: u64 (LE)]`)
pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, args) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        0 => {
            log!("Instruction: CreateToken");
            create_token(accounts, args)
        }
        1 => {
            log!("Instruction: MintTokens");
            mint_tokens(accounts, args)
        }
        2 => {
            log!("Instruction: TransferTokens");
            transfer_tokens(accounts, args)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
