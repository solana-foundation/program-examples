use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::state::PageVisits;

pub fn create_page_visits(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [page_visits_account, user, payer, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let account_span = PageVisits::ACCOUNT_SPACE;
    let lamports_required = (Rent::get()?).try_minimum_balance(account_span)?;

    let bump_bytes = &instruction_data[4..5];

    let seeds =
        [Seed::from(PageVisits::SEED_PREFIX.as_bytes()), Seed::from(user.address().as_ref()), Seed::from(bump_bytes)];

    let signers = Signer::from(&seeds);

    CreateAccount {
        from: payer,
        to: page_visits_account,
        lamports: lamports_required,
        space: account_span as u64,
        owner: program_id,
    }
    .invoke_signed(&[signers])?;

    Ok(())
}
