use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::instructions::{
    create_new_account::create_new_account,
    init_rent_vault::{init_rent_vault, InitRentVaultArgs},
};

#[derive(BorshSerialize, BorshDeserialize)]
pub enum MyInstruction {
    InitRentVault(InitRentVaultArgs),
    CreateNewAccount,
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let instruction = MyInstruction::try_from_slice(input)?;
    match instruction {
        MyInstruction::InitRentVault(args) => init_rent_vault(program_id, accounts, args),
        MyInstruction::CreateNewAccount => create_new_account(program_id, accounts),
    }
}
