use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_pubkey::derive_address;

use crate::state::RentVault;

pub fn create_new_account(program_id: &Address, accounts: &[AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [new_account, rent_vault, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let bump = instruction_data[0];

    let rent_vault_pda = derive_address(&[RentVault::SEED_PREFIX.as_bytes()], Some(bump), program_id.as_array());

    assert!(rent_vault.address().as_array().eq(&rent_vault_pda));

    // Assuming this account has no inner data (size 0)
    //
    let lamports_required_for_rent = (Rent::get()?).try_minimum_balance(0)?;

    rent_vault.set_lamports(rent_vault.lamports() - lamports_required_for_rent);
    new_account.set_lamports(new_account.lamports() + lamports_required_for_rent);

    Ok(())
}
