#![no_std]

use pinocchio::Resize;
use pinocchio::{
    cpi::{Seed, Signer},
    entrypoint,
    error::ProgramError,
    nostd_panic_handler,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

entrypoint!(process_instruction);
nostd_panic_handler!();

fn process_instruction(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    match instruction_data.split_first() {
        Some((&CREATE_DISCRIMINATOR, data)) => process_user(program_id, accounts, data),
        Some((&CLOSE_DISCRIMINATOR, _)) => process_close(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

pub const CREATE_DISCRIMINATOR: u8 = 0;
pub const CLOSE_DISCRIMINATOR: u8 = 1;

pub struct User<'a> {
    pub name: &'a [u8],
}

impl<'a> User<'a> {
    pub const SEED_PREFIX: &'static str = "USER";
    pub const LEN: usize = 16;
}

fn process_user(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [target_account, payer, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let rent = Rent::get()?;

    let account_span = User::LEN;
    let lamports_required = rent.try_minimum_balance(account_span)?;

    let bump_bytes = instruction_data[0].to_le_bytes();

    let seeds =
        [Seed::from(User::SEED_PREFIX.as_bytes()), Seed::from(payer.address().as_ref()), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    CreateAccount {
        from: payer,
        to: target_account,
        lamports: lamports_required,
        space: account_span as u64,
        owner: program_id,
    }
    .invoke_signed(&signers)?;

    let mut address_info_data = target_account.try_borrow_mut()?;
    address_info_data.copy_from_slice(&instruction_data[1..]);

    Ok(())
}

fn process_close(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [target_account, payer, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Only the account's owner may close it.
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify target_account is actually payer's User PDA, not another user's account.
    let (expected_user_pda, _) =
        Address::find_program_address(&[User::SEED_PREFIX.as_bytes(), payer.address().as_ref()], program_id);
    if target_account.address() != &expected_user_pda {
        return Err(ProgramError::IncorrectProgramId);
    }

    let rent = Rent::get()?;

    let account_span = 0usize;
    let lamports_required = rent.try_minimum_balance(account_span)?;

    let diff = target_account.lamports() - lamports_required;

    target_account.set_lamports(target_account.lamports() - diff);
    payer.set_lamports(payer.lamports() + diff);

    target_account.resize(account_span)?;

    unsafe {
        target_account.assign(system_program.address());
    }

    Ok(())
}
