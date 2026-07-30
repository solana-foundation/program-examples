//! Account validation and PDA creation helpers.

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};

use crate::GachaError;

/// Returns an error unless `account` is a transaction signer.
pub fn check_signer(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(GachaError::NotSigner.into());
    }
    Ok(())
}

/// Returns an error unless `account` is marked writable.
pub fn check_writable(account: &AccountView) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(GachaError::AccountNotWritable.into());
    }
    Ok(())
}

/// Returns an error unless `account` is the System Program.
pub fn check_system_program(account: &AccountView) -> Result<(), ProgramError> {
    if account.address().ne(&pinocchio_system::ID) {
        return Err(GachaError::NotSystemProgram.into());
    }
    Ok(())
}

/// Creates and allocates an `owner`-owned PDA, funding rent from `payer`.
///
/// `seeds` must include the bump seed as the final element. Idempotent against a
/// pre-funded PDA address: tops up rent then allocates and assigns, so a
/// griefer's donation to the address cannot brick creation.
pub fn create_pda_account(
    payer: &AccountView,
    account: &AccountView,
    seeds: &[Seed],
    space: usize,
    owner: &Address,
) -> ProgramResult {
    let lamports = Rent::get()?.try_minimum_balance(space)?;
    let signer = [Signer::from(seeds)];

    if account.lamports() == 0 {
        CreateAccount { from: payer, to: account, lamports, space: space as u64, owner }.invoke_signed(&signer)?;
    } else {
        let required = lamports.saturating_sub(account.lamports());
        if required > 0 {
            Transfer { from: payer, to: account, lamports: required }.invoke()?;
        }
        Allocate { account, space: space as u64 }.invoke_signed(&signer)?;
        Assign { account, owner }.invoke_signed(&signer)?;
    }

    Ok(())
}
