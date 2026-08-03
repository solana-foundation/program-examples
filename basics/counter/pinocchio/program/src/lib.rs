#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};
use pinocchio_log::log;

mod state;
pub use state::*;

pinocchio::address::declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[cfg(not(feature = "no-entrypoint"))]
use pinocchio::entrypoint;

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

nostd_panic_handler!();

pub fn process_instruction(
    _program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (instruction_discriminant, instruction_data_inner) = instruction_data.split_at(1);
    match instruction_discriminant[0] {
        0 => {
            log!("Instruction: Increment");
            process_increment_counter(accounts, instruction_data_inner)?;
        }
        _ => {
            log!("Error: unknown instruction");
        }
    }
    Ok(())
}

pub fn process_increment_counter(accounts: &mut [AccountView], _instruction_data: &[u8]) -> Result<(), ProgramError> {
    let [counter_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    assert!(counter_account.is_writable(), "Counter account must be writable");

    let mut counter_account_data = counter_account.try_borrow_mut()?;

    // Read the current counter value (first 8 bytes)
    let counter_bytes: [u8; 8] =
        counter_account_data[0..8].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    let counter = u64::from_le_bytes(counter_bytes);

    // Increment the counter
    let new_counter = counter + 1;

    // Write the new counter value back
    counter_account_data[0..8].copy_from_slice(&new_counter.to_le_bytes());

    log!(8, "Counter incremented to {}", new_counter);
    Ok(())
}
