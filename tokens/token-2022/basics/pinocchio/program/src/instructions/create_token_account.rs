use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::instructions::{ACCOUNT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_ACCOUNT_SEED};

/// `InitializeAccount3` instruction discriminator.
const INITIALIZE_ACCOUNT_3: u8 = 18;

/// Creates a Token-2022 token account (no extensions) at the PDA
/// `[b"token-2022-token-account", signer, mint]`, owned by the signer.
///
/// This mirrors the anchor example's `create_token_account`; the associated
/// token account variant (see `create_associated_token_account`) is the more
/// common way to hold tokens.
///
/// Accounts:
///   0. `[signer, writable]` signer (owner + payer)
///   1. `[]`                 mint account
///   2. `[writable]`         token account (the derived PDA, created here)
///   3. `[]`                 system program
///   4. `[]`                 Token-2022 program
///
/// Instruction data: none.
pub fn create_token_account(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [signer, mint_account, token_account, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Derive the token account PDA and confirm the supplied account matches it.
    let (token_pda, bump) = Address::find_program_address(
        &[TOKEN_ACCOUNT_SEED, signer.address().as_ref(), mint_account.address().as_ref()],
        program_id,
    );
    if token_account.address() != &token_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(ACCOUNT_SIZE)?;
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(TOKEN_ACCOUNT_SEED),
        Seed::from(signer.address().as_ref()),
        Seed::from(mint_account.address().as_ref()),
        Seed::from(&bump_bytes),
    ];
    let signers = [Signer::from(&seeds)];

    log!("Creating token account");
    CreateAccount {
        from: signer,
        to: token_account,
        lamports,
        space: ACCOUNT_SIZE as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke_signed(&signers)?;

    log!("Initializing token account");
    let init_data = build_initialize_account3_data(signer.address());
    let init_accounts =
        [InstructionAccount::writable(token_account.address()), InstructionAccount::readonly(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_accounts, data: &init_data },
        &[*token_account, *mint_account],
    )?;

    log!("Token account created");
    Ok(())
}

/// Serializes an `InitializeAccount3` instruction (variant 18).
///
/// Layout: `[18] owner: Pubkey`. The owner is passed in the instruction data
/// rather than as an account, and no rent sysvar account is required.
fn build_initialize_account3_data(owner: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(33);
    data.push(INITIALIZE_ACCOUNT_3);
    data.extend_from_slice(owner.as_ref());
    data
}
