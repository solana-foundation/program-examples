use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_account_info::AccountInfo,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
};

use crate::instructions::{
    create::{create_token, CreateTokenArgs},
    init::init,
    mint::mint_to,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
enum MyInstruction {
    Init,
    Create(CreateTokenArgs),
    Mint,
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let instruction = MyInstruction::try_from_slice(instruction_data)?;

    match instruction {
        MyInstruction::Init => init(program_id, accounts),
        MyInstruction::Create(args) => create_token(program_id, accounts, args),
        MyInstruction::Mint => mint_to(program_id, accounts),
    }
}
