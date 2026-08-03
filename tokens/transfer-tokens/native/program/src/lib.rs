use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey};

pub mod instructions;
pub mod mpl_util;
pub mod processor;

entrypoint!(process_instruction);

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    processor::process_instruction(program_id, accounts, instruction_data)
}
