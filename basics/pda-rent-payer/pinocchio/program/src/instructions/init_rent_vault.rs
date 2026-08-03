use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::state::RentVault;

pub struct InitRentVaultArgs {
    pub fund_lamports: u64,
}

pub fn init_rent_vault(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [rent_vault, payer, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let bump = instruction_data[0];

    let rent_vault_pda = Address::create_program_address(&[RentVault::SEED_PREFIX.as_bytes(), &[bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;

    assert!(rent_vault.address().eq(&rent_vault_pda));

    // Lamports for rent on the vault, plus the desired additional funding
    //
    let fund_lamports =
        u64::from_le_bytes(instruction_data[1..9].try_into().map_err(|_| ProgramError::InvalidInstructionData)?);
    let lamports_required = (Rent::get()?).try_minimum_balance(0)? + fund_lamports;

    let bump_bytes = bump.to_le_bytes();

    let seeds = [Seed::from(RentVault::SEED_PREFIX.as_bytes()), Seed::from(&bump_bytes)];

    let signer_seed = Signer::from(&seeds);

    CreateAccount { from: payer, to: rent_vault, lamports: lamports_required, space: 0, owner: program_id }
        .invoke_signed(&[signer_seed])?;

    Ok(())
}
