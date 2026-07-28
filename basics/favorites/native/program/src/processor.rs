use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

use crate::instructions::{create_pda::*, get_pda::*};
pub use crate::state::Favorites;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshDeserialize, BorshSerialize)]
pub enum FavoritesInstruction {
    CreatePda(Favorites),
    GetPda,
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let instruction = FavoritesInstruction::try_from_slice(instruction_data)?;

    match instruction {
        FavoritesInstruction::CreatePda(data) => create_pda(program_id, accounts, data),
        FavoritesInstruction::GetPda => get_pda(program_id, accounts),
    }?;

    Ok(())
}
