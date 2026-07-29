use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::instructions::MintTo;

use crate::instructions::parse_u64;

/// Mints tokens into a wallet's associated token account, creating that account
/// first if it does not already exist.
///
/// Accounts:
///   0. `[writable]`         mint account
///   1. `[writable]`         destination associated token account
///   2. `[signer]`           mint authority
///   3. `[signer, writable]` payer (funds the associated token account)
///   4. `[]`                 wallet that owns the associated token account
///   5. `[]`                 system program
///   6. `[]`                 token program
///   7. `[]`                 associated token program
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn mint_tokens(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [mint_account, token_account, mint_authority, payer, wallet, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = parse_u64(data)?;

    log!("Creating associated token account if needed");
    CreateIdempotent {
        funding_account: payer,
        account: token_account,
        wallet,
        mint: mint_account,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Minting tokens");
    MintTo {
        multisig_signers: &[] as &[&AccountView],
        mint: mint_account,
        account: token_account,
        mint_authority,
        amount,
    }
    .invoke()?;

    log!("Tokens minted successfully");
    Ok(())
}
