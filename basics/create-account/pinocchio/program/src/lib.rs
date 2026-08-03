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

fn process_instruction(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [payer, new_account, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    log!("Program invoked. Creating a system account...");
    log!("  New public key will be:");
    log!("{}", new_account.address().as_array());

    // Determine the necessary minimum rent by calculating the account's size
    let account_span = instruction_data.len();
    let lamports_required = (Rent::get()?).try_minimum_balance(account_span)?;

    log!(50, "Account span: {}", account_span);
    log!(50, "Lamports required: {}", lamports_required);

    CreateAccount {
        from: payer,
        to: new_account,
        lamports: lamports_required,
        space: account_span as u64,
        owner: &pinocchio_system::ID,
    }
    .invoke()?;

    log!("Account created succesfully.");
    Ok(())
}
