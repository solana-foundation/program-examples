use borsh::{BorshDeserialize, BorshSerialize};
use {
    solana_account_info::{next_account_info, AccountInfo},
    solana_cpi::invoke_signed,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
    solana_sysvar::{rent::Rent, Sysvar},
};

use crate::state::RentVault;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct InitRentVaultArgs {
    pub fund_lamports: u64,
}

pub fn init_rent_vault(program_id: &Pubkey, accounts: &[AccountInfo], args: InitRentVaultArgs) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let rent_vault = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    let (rent_vault_pda, rent_vault_bump) =
        Pubkey::find_program_address(&[RentVault::SEED_PREFIX.as_bytes()], program_id);
    assert!(rent_vault.key.eq(&rent_vault_pda));

    // Lamports for rent on the vault, plus the desired additional funding
    //
    let lamports_required = (Rent::get()?).minimum_balance(0) + args.fund_lamports;

    invoke_signed(
        &solana_system_interface::instruction::create_account(
            payer.key,
            rent_vault.key,
            lamports_required,
            0,
            program_id,
        ),
        &[payer.clone(), rent_vault.clone(), system_program.clone()],
        &[&[RentVault::SEED_PREFIX.as_bytes(), &[rent_vault_bump]]],
    )?;

    Ok(())
}
