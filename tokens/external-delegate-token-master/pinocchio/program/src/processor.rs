use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{authority_transfer, initialize, set_ethereum_address, transfer_tokens};

const INITIALIZE: u8 = 0;
const SET_ETHEREUM_ADDRESS: u8 = 1;
const TRANSFER_TOKENS: u8 = 2;
const AUTHORITY_TRANSFER: u8 = 3;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data {
        [INITIALIZE, ..] => {
            log!("Instruction: Initialize");
            initialize(program_id, accounts)
        }
        [SET_ETHEREUM_ADDRESS, data @ ..] => {
            log!("Instruction: SetEthereumAddress");
            set_ethereum_address(program_id, accounts, data)
        }
        [TRANSFER_TOKENS, data @ ..] => {
            log!("Instruction: TransferTokens");
            transfer_tokens(program_id, accounts, data)
        }
        [AUTHORITY_TRANSFER, data @ ..] => {
            log!("Instruction: AuthorityTransfer");
            authority_transfer(program_id, accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
