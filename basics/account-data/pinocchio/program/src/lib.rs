#![no_std]

use pinocchio::{
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
        Some((0, data)) => process_create(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

pub struct AddressInfo<'a> {
    pub name: &'a [u8],
    pub house_number: u8,
    pub street: &'a [u8],
    pub city: &'a [u8],
}

impl<'a> AddressInfo<'a> {
    const LEN: usize = 51;
}

fn process_create(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [address_info, payer, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::InvalidAccountOwner);
    }

    if address_info.lamports().ne(&0) {
        return Err(ProgramError::InvalidAccountData);
    };

    if !pinocchio_system::check_id(system_program.address()) {
        return Err(ProgramError::InvalidAccountData);
    }

    if instruction_data.len() < AddressInfo::LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    let rent = Rent::get()?;

    let account_span = AddressInfo::LEN;
    let lamports_required = rent.try_minimum_balance(account_span)?;

    CreateAccount {
        from: payer,
        to: address_info,
        lamports: lamports_required,
        space: account_span as u64,
        owner: program_id,
    }
    .invoke()?;

    let mut address_info_data = address_info.try_borrow_mut()?;
    address_info_data.copy_from_slice(instruction_data);

    Ok(())
}
