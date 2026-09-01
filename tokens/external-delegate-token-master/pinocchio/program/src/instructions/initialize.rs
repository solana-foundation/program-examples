use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::state::{UserAccount, USER_ACCOUNT_SIZE};

/// Creates a user account, recording the Solana wallet that controls it.
///
/// The Ethereum address starts zeroed and is installed separately, so a fresh
/// account cannot be spent from until its owner opts in.
///
/// Accounts:
///   0. `[signer, writable]` user account (a fresh keypair)
///   1. `[signer, writable]` authority (pays)
///   2. `[]`                 system program
///
/// Instruction data: none beyond the discriminator.
pub fn initialize(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [user_account, authority, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() || !user_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // The user account is a plain keypair rather than a PDA — matching the
    // Anchor version, whose `#[account(init, payer = authority)]` carries no
    // seeds — so `CreateAccount` is safe here: the address is not derivable and
    // cannot be pre-funded by a stranger.
    log!("Creating user account");
    CreateAccount {
        from: authority,
        to: user_account,
        lamports: Rent::get()?.try_minimum_balance(USER_ACCOUNT_SIZE)?,
        space: USER_ACCOUNT_SIZE as u64,
        owner: program_id,
    }
    .invoke()?;

    UserAccount::from_bytes(&mut user_account.try_borrow_mut()?)?.initialize(authority.address());

    log!("User account initialized");
    Ok(())
}
