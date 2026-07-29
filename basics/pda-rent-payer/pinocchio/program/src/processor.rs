use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::instructions::{
    create_new_account::create_new_account,
    init_rent_vault::{init_rent_vault, InitRentVaultArgs},
};

pub enum MyInstruction {
    InitRentVault(InitRentVaultArgs),
    CreateNewAccount,
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.split_first() {
        Some((0, data)) => init_rent_vault(program_id, accounts, data),
        Some((1, data)) => create_new_account(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
