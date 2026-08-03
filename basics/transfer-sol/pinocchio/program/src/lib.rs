#![no_std]

use pinocchio::{entrypoint, error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};
use pinocchio_system::instructions::Transfer;

entrypoint!(process_instruction);
nostd_panic_handler!();

fn process_instruction(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    match instruction_data.split_first() {
        Some((&CPI_TRANSFER_DISCRIMINATOR, data)) => transfer_sol_with_cpi(accounts, data),
        Some((&PROGRAM_TRANSFER_DISCRIMINATOR, data)) => transfer_sol_with_program(accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

pub const CPI_TRANSFER_DISCRIMINATOR: u8 = 0;
pub const PROGRAM_TRANSFER_DISCRIMINATOR: u8 = 1;

fn transfer_sol_with_cpi(accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [payer, recipient, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount_bytes: [u8; 8] = instruction_data[0..8].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    let amount = u64::from_le_bytes(amount_bytes);

    Transfer { from: payer, to: recipient, lamports: amount }.invoke()?;

    Ok(())
}

fn transfer_sol_with_program(accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [payer, recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount_bytes: [u8; 8] = instruction_data[0..8].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    let amount = u64::from_le_bytes(amount_bytes);

    payer.set_lamports(payer.lamports() - amount);
    recipient.set_lamports(recipient.lamports() + amount);

    Ok(())
}
