use {
    solana_account_info::AccountInfo, solana_program_entrypoint::entrypoint, solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
};

pub mod instructions;
pub mod mpl_util;
pub mod processor;

entrypoint!(process_instruction);

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    processor::process_instruction(program_id, accounts, instruction_data)
}
