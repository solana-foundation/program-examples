use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};
use pinocchio_log::log;

use crate::instructions::{parse_u64, TOKEN_2022_PROGRAM_ID};

/// `MintTo` instruction discriminator.
const MINT_TO: u8 = 7;

/// Mints `amount` tokens to a receiver token account. The signer must be the
/// mint authority.
///
/// Accounts:
///   0. `[signer]`   signer (mint authority)
///   1. `[writable]` mint account
///   2. `[writable]` receiver token account
///   3. `[]`         Token-2022 program
///
/// Instruction data: `[amount: u64 (LE)]`.
pub fn mint_token(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [signer, mint_account, receiver, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = parse_u64(data)?;

    // MintTo data: `[7] amount: u64`.
    let mut mint_data = [0u8; 9];
    mint_data[0] = MINT_TO;
    mint_data[1..].copy_from_slice(&amount.to_le_bytes());

    // Accounts: mint (writable), destination (writable), authority (signer).
    let mint_accounts = [
        InstructionAccount::writable(mint_account.address()),
        InstructionAccount::writable(receiver.address()),
        InstructionAccount::readonly_signer(signer.address()),
    ];

    log!("Minting tokens");
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint_account, *receiver, *signer],
    )?;

    log!("Tokens minted");
    Ok(())
}
