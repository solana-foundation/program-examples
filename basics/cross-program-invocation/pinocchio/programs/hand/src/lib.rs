#![no_std]

use pinocchio::{
    cpi::invoke,
    entrypoint,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    nostd_panic_handler, AccountView, Address, ProgramResult,
};

entrypoint!(process_instruction);
nostd_panic_handler!();

// Matches lever's switch_power discriminator.
const LEVER_IX_SWITCH_POWER: u8 = 1;

// Cap the forwarded name length so we can build the CPI buffer on the stack
// (pinocchio runs in `no_std` without an allocator by default).
const MAX_NAME_LEN: usize = 128;
const CPI_DATA_BUF: usize = MAX_NAME_LEN + 1;

fn process_instruction(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [power, lever_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let name = instruction_data;
    if name.len() > MAX_NAME_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut cpi_data = [0u8; CPI_DATA_BUF];
    cpi_data[0] = LEVER_IX_SWITCH_POWER;
    cpi_data[1..1 + name.len()].copy_from_slice(name);

    let metas = [InstructionAccount::writable(power.address())];
    let ix =
        InstructionView { program_id: lever_program.address(), accounts: &metas, data: &cpi_data[..1 + name.len()] };

    invoke::<1, _>(&ix, &[*power])
}
