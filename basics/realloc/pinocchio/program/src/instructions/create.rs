use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::state::AddressInfo;

pub fn create_address_info(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [target_account, payer, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let account_span = AddressInfo::LEN;
    let lamports_required = (Rent::get()?).try_minimum_balance(account_span)?;

    CreateAccount {
        from: payer,
        to: target_account,
        lamports: lamports_required,
        space: account_span as u64,
        owner: program_id,
    }
    .invoke()?;

    let mut data = target_account.try_borrow_mut()?;
    data.copy_from_slice(instruction_data);

    Ok(())
}
