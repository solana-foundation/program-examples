#![no_std]

use pinocchio::{entrypoint, error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use pinocchio_system::instructions::CreateAccount;

entrypoint!(process_instruction);
nostd_panic_handler!();

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

fn process_instruction(_program_id: &Address, accounts: &[AccountView], _instruction_data: &[u8]) -> ProgramResult {
    let [payer, new_account, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    log!("Program invoked. Creating a system account...");
    log!("  New public key will be:");
    log!("{}", new_account.address().as_array());

    CreateAccount { from: payer, to: new_account, lamports: LAMPORTS_PER_SOL, space: 0, owner: &pinocchio_system::ID }
        .invoke()?;

    log!("Account created succesfully.");
    Ok(())
}
