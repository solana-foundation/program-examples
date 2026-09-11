use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

use crate::state::RentVault;

// NOTE: this example does not restrict who may call it. A real rent vault
// needs an authority check: an authority recorded at initialization with
// seeds that bind the vault to one funder, or a per-caller limit. A bare
// signer alone is not enough, since any keypair can sign for itself.
pub fn create_new_account(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let new_account = next_account_info(accounts_iter)?;
    let rent_vault = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;

    let (rent_vault_pda, _rent_vault_bump) =
        Pubkey::find_program_address(&[RentVault::SEED_PREFIX.as_bytes()], program_id);
    assert!(rent_vault.key.eq(&rent_vault_pda));

    // Assuming this account has no inner data (size 0)
    //
    let lamports_required_for_rent = (Rent::get()?).minimum_balance(0);

    **rent_vault.lamports.borrow_mut() -= lamports_required_for_rent;
    **new_account.lamports.borrow_mut() += lamports_required_for_rent;

    Ok(())
}
