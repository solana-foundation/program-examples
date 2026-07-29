use pinocchio::Resize;
use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_system::instructions::Transfer;

use crate::state::{EnhancedAddressInfo, WorkInfo};

pub fn reallocate_without_zero_init(accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [target_account, payer, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let account_span = EnhancedAddressInfo::LEN;
    let lamports_required = (Rent::get()?).try_minimum_balance(account_span)?;

    let diff = lamports_required - target_account.lamports();

    Transfer { from: payer, to: target_account, lamports: diff }.invoke()?;

    target_account.resize(account_span)?;

    let mut target_account_data = target_account.try_borrow_mut()?;
    target_account_data[25..37].copy_from_slice(instruction_data);

    Ok(())
}

pub fn reallocate_zero_init(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [target_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let account_span = WorkInfo::LEN;

    target_account.resize(account_span)?;

    let mut target_account_data = target_account.try_borrow_mut()?;
    target_account_data.copy_from_slice(data);

    Ok(())
}
