#![no_std]

use pinocchio::{entrypoint, error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};
use pinocchio_log::log;

entrypoint!(process_instruction);
nostd_panic_handler!();

fn process_instruction(program_id: &Address, accounts: &mut [AccountView], _instruction_data: &[u8]) -> ProgramResult {
    // You can verify the list has the correct number of accounts.
    // This error will get thrown by default if you
    //      try to reach past the end of the iter.
    let [payer, account_to_create, account_to_change, system_program] = accounts else {
        log!("This instruction requires 4 accounts:");
        log!("  payer, account_to_create, account_to_change, system_program");
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // You can make sure payer is a signer

    if !payer.is_signer() {
        log!("The program expected the account to be a signer.");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // You can make sure an account has NOT been initialized.

    log!("New account: {}", account_to_create.address().as_array());
    if account_to_create.lamports() != 0 {
        log!("The program expected the account to create to not yet be initialized.");
        return Err(ProgramError::AccountAlreadyInitialized);
    };
    // (Create account...)

    // You can also make sure an account has been initialized.
    log!("Account to change: {}", account_to_change.address().as_array());
    if account_to_change.lamports() == 0 {
        log!("The program expected the account to change to be initialized.");
        return Err(ProgramError::UninitializedAccount);
    };

    // If we want to modify an account's data, it must be owned by our program.
    if !account_to_change.owned_by(program_id) {
        log!("Account to change does not have the correct program id.");
        return Err(ProgramError::IncorrectProgramId);
    };

    // You can also check pubkeys against constants.
    if system_program.address() != &pinocchio_system::ID {
        return Err(ProgramError::IncorrectProgramId);
    };

    Ok(())
}
