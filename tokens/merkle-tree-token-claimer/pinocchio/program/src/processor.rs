use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{claim_airdrop, initialize_airdrop_data, update_tree};

const INITIALIZE_AIRDROP_DATA: u8 = 0;
const UPDATE_TREE: u8 = 1;
const CLAIM_AIRDROP: u8 = 2;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data {
        [INITIALIZE_AIRDROP_DATA, data @ ..] => {
            log!("Instruction: InitializeAirdropData");
            initialize_airdrop_data(program_id, accounts, data)
        }
        [UPDATE_TREE, data @ ..] => {
            log!("Instruction: UpdateTree");
            update_tree(program_id, accounts, data)
        }
        [CLAIM_AIRDROP, data @ ..] => {
            log!("Instruction: ClaimAirdrop");
            claim_airdrop(program_id, accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
