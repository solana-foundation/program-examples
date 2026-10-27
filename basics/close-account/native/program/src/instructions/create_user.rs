use borsh::BorshSerialize;
use {
    solana_account_info::{next_account_info, AccountInfo},
    solana_cpi::invoke_signed,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
    solana_sysvar::{rent::Rent, Sysvar},
};

use crate::state::user::User;

pub fn create_user(program_id: &Pubkey, accounts: &[AccountInfo], data: User) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let target_account = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    let account_span = borsh::to_vec(&data)?.len();
    let lamports_required = (Rent::get()?).minimum_balance(account_span);

    let (_, bump) = Pubkey::find_program_address(&[User::SEED_PREFIX.as_bytes(), payer.key.as_ref()], program_id);

    invoke_signed(
        &solana_system_interface::instruction::create_account(
            payer.key,
            target_account.key,
            lamports_required,
            account_span as u64,
            program_id,
        ),
        &[payer.clone(), target_account.clone(), system_program.clone()],
        &[&[User::SEED_PREFIX.as_bytes(), payer.key.as_ref(), &[bump]]],
    )?;

    data.serialize(&mut &mut target_account.data.borrow_mut()[..])?;
    Ok(())
}
