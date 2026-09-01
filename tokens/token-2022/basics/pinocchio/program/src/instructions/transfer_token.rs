use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;

use crate::instructions::{parse_u64, MINT_DECIMALS, TOKEN_2022_PROGRAM_ID};

/// `TransferChecked` instruction discriminator.
const TRANSFER_CHECKED: u8 = 12;

/// Transfers `amount` tokens from the signer's account to `to`, creating `to`'s
/// associated token account first if it does not already exist.
///
/// Accounts:
///   0. `[signer, writable]` signer (source authority + payer)
///   1. `[writable]`         source token account
///   2. `[]`                 recipient wallet (owner of the destination ATA)
///   3. `[writable]`         destination associated token account
///   4. `[writable]`         mint account
///   5. `[]`                 Token-2022 program
///   6. `[]`                 system program
///   7. `[]`                 associated token program
///
/// Instruction data: `[amount: u64 (LE)]`.
pub fn transfer_token(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [signer, from, recipient, to_ata, mint_account, token_program, system_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = parse_u64(data)?;

    log!("Creating recipient associated token account if needed");
    CreateIdempotent {
        funding_account: signer,
        account: to_ata,
        wallet: recipient,
        mint: mint_account,
        system_program,
        token_program,
    }
    .invoke()?;

    // TransferChecked data: `[12] amount: u64 decimals: u8`.
    let mut transfer_data = [0u8; 10];
    transfer_data[0] = TRANSFER_CHECKED;
    transfer_data[1..9].copy_from_slice(&amount.to_le_bytes());
    transfer_data[9] = MINT_DECIMALS;

    // Accounts: source (writable), mint, destination (writable), authority (signer).
    let transfer_accounts = [
        InstructionAccount::writable(from.address()),
        InstructionAccount::readonly(mint_account.address()),
        InstructionAccount::writable(to_ata.address()),
        InstructionAccount::readonly_signer(signer.address()),
    ];

    log!("Transferring tokens");
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &transfer_accounts, data: &transfer_data },
        &[*from, *mint_account, *to_ata, *signer],
    )?;

    log!("Tokens transferred");
    Ok(())
}
