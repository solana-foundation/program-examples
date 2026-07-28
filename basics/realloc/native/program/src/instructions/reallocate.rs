use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    rent::Rent,
    sysvar::Sysvar,
};

use crate::state::{AddressInfo, EnhancedAddressInfo, EnhancedAddressInfoExtender, WorkInfo};

pub fn reallocate_without_zero_init(accounts: &[AccountInfo], args: EnhancedAddressInfoExtender) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let target_account = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    let address_info_data = AddressInfo::try_from_slice(&target_account.data.borrow())?;
    let enhanced_address_info_data = EnhancedAddressInfo::from_address_info(address_info_data, args.state, args.zip);

    let account_span = borsh::to_vec(&enhanced_address_info_data)?.len();
    let lamports_required = (Rent::get()?).minimum_balance(account_span);

    let diff = lamports_required - target_account.lamports();
    invoke(
        &solana_system_interface::instruction::transfer(payer.key, target_account.key, diff),
        &[payer.clone(), target_account.clone(), system_program.clone()],
    )?;

    target_account.resize(account_span)?;

    enhanced_address_info_data.serialize(&mut &mut target_account.data.borrow_mut()[..])?;

    Ok(())
}

pub fn reallocate_zero_init(accounts: &[AccountInfo], data: WorkInfo) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let target_account = next_account_info(accounts_iter)?;

    let account_span = borsh::to_vec(&data)?.len();

    target_account.resize(account_span)?;

    data.serialize(&mut &mut target_account.data.borrow_mut()[..])?;

    Ok(())
}
