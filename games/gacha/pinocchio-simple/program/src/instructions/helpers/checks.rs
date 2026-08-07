//! Account-flag and program-identity guards shared by every instruction.

use pinocchio::{error::ProgramError, AccountView};

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
