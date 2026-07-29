use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeMint2;

use crate::instructions::MINT_SIZE;

/// Creates and initializes a new SPL Token mint.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority
///   2. `[signer, writable]` payer (funds the new mint account)
///   3. `[]`                 system program
///   4. `[]`                 token program
///
/// Instruction data: `[decimals: u8]`
pub fn create_token(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [mint_account, mint_authority, payer, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let decimals = *data.first().ok_or(ProgramError::InvalidInstructionData)?;

    // Fund the mint account with enough lamports to stay rent-exempt.
    let lamports = Rent::get()?.try_minimum_balance(MINT_SIZE)?;

    log!("Creating mint account");
    CreateAccount { from: payer, to: mint_account, lamports, space: MINT_SIZE as u64, owner: &pinocchio_token::ID }
        .invoke()?;

    log!("Initializing mint account");
    InitializeMint2 {
        mint: mint_account,
        decimals,
        mint_authority: mint_authority.address(),
        freeze_authority: Some(mint_authority.address()),
    }
    .invoke()?;

    log!("Mint created successfully");
    Ok(())
}
