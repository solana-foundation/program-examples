use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use borsh::{BorshDeserialize, BorshSerialize};

// Definição das contas e instruções aqui
// Exemplo de uma instrução simples
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let account = next_account_info(accounts_iter)?;

    if account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    msg!("Hello, Native Token Swap!");

    Ok(())
}
