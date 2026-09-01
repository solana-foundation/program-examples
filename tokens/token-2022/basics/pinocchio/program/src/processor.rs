use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
    create_associated_token_account, create_token, create_token_account, mint_token, transfer_token,
};

/// Instruction discriminators for this program. The client prefixes the
/// instruction data with one of these bytes to select a handler.
const CREATE_TOKEN: u8 = 0;
const CREATE_TOKEN_ACCOUNT: u8 = 1;
const CREATE_ASSOCIATED_TOKEN_ACCOUNT: u8 = 2;
const TRANSFER_TOKEN: u8 = 3;
const MINT_TOKEN: u8 = 4;

/// Entrypoint: dispatches on the leading discriminator byte. Mirrors the five
/// instructions of the anchor `basics` example.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, data) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminator {
        CREATE_TOKEN => {
            log!("Instruction: CreateToken");
            create_token(program_id, accounts, data)
        }
        CREATE_TOKEN_ACCOUNT => {
            log!("Instruction: CreateTokenAccount");
            create_token_account(program_id, accounts)
        }
        CREATE_ASSOCIATED_TOKEN_ACCOUNT => {
            log!("Instruction: CreateAssociatedTokenAccount");
            create_associated_token_account(accounts)
        }
        TRANSFER_TOKEN => {
            log!("Instruction: TransferToken");
            transfer_token(accounts, data)
        }
        MINT_TOKEN => {
            log!("Instruction: MintToken");
            mint_token(accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
