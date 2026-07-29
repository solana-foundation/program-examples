#![no_std]

use pinocchio::{
    entrypoint,
    error::ProgramError,
    nostd_panic_handler,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

entrypoint!(process_instruction);
nostd_panic_handler!();

// Single-byte account: stores `is_on` as 0 or 1.
const POWER_ACCOUNT_SPACE: u64 = 1;

// Instruction discriminators
const IX_INITIALIZE: u8 = 0;
const IX_SWITCH_POWER: u8 = 1;

fn process_instruction(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    match instruction_data.split_first() {
        Some((&IX_INITIALIZE, _)) => initialize(program_id, accounts),
        Some((&IX_SWITCH_POWER, name)) => switch_power(accounts, name),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [power, user, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let lamports = Rent::get()?.try_minimum_balance(POWER_ACCOUNT_SPACE as usize)?;

    CreateAccount { from: user, to: power, lamports, space: POWER_ACCOUNT_SPACE, owner: program_id }.invoke()?;

    let mut data = power.try_borrow_mut()?;
    data[0] = 0;
    Ok(())
}

fn switch_power(accounts: &mut [AccountView], name: &[u8]) -> ProgramResult {
    let [power] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let mut data = power.try_borrow_mut()?;
    data[0] = if data[0] == 0 { 1 } else { 0 };
    let is_on = data[0] == 1;
    drop(data);

    let name_str = core::str::from_utf8(name).map_err(|_| ProgramError::InvalidInstructionData)?;
    log!("{} is pulling the power switch!", name_str);

    if is_on {
        log!("The power is now on.");
    } else {
        log!("The power is now off!");
    }

    Ok(())
}
