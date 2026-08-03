use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::instruction::transfer_sol_with_cpi;
use crate::instruction::transfer_sol_with_program;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum TransferInstruction {
    CpiTransfer(u64),
    ProgramTransfer(u64),
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let instruction = TransferInstruction::try_from_slice(input)?;
    match instruction {
        TransferInstruction::CpiTransfer(args) => transfer_sol_with_cpi(accounts, args),
        TransferInstruction::ProgramTransfer(args) => transfer_sol_with_program(program_id, accounts, args),
    }
}
