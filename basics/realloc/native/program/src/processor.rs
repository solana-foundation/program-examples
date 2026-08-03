use crate::instructions::*;
use crate::state::*;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum ReallocInstruction {
    Create(AddressInfo),
    ReallocateWithoutZeroInit(EnhancedAddressInfoExtender),
    ReallocateZeroInit(WorkInfo),
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let instruction = ReallocInstruction::try_from_slice(input)?;
    match instruction {
        ReallocInstruction::Create(data) => create_address_info(program_id, accounts, data),
        ReallocInstruction::ReallocateWithoutZeroInit(data) => reallocate_without_zero_init(accounts, data),
        ReallocInstruction::ReallocateZeroInit(data) => reallocate_zero_init(accounts, data),
    }
}
