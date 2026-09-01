use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{chop_tree, init_player, mint_nft};

const INIT_PLAYER: u8 = 0;
const CHOP_TREE: u8 = 1;
const MINT_NFT: u8 = 2;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data {
        [INIT_PLAYER, data @ ..] => {
            log!("Instruction: InitPlayer");
            init_player(program_id, accounts, data)
        }
        [CHOP_TREE, data @ ..] => {
            log!("Instruction: ChopTree");
            chop_tree(program_id, accounts, data)
        }
        [MINT_NFT, ..] => {
            log!("Instruction: MintNft");
            mint_nft(program_id, accounts)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
