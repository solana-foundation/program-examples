use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
    create_amm, create_pool, deposit_liquidity, swap_exact_tokens_for_tokens, withdraw_liquidity,
};

const CREATE_AMM: u8 = 0;
const CREATE_POOL: u8 = 1;
const DEPOSIT_LIQUIDITY: u8 = 2;
const WITHDRAW_LIQUIDITY: u8 = 3;
const SWAP_EXACT_TOKENS_FOR_TOKENS: u8 = 4;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data {
        [CREATE_AMM, data @ ..] => {
            log!("Instruction: CreateAmm");
            create_amm(program_id, accounts, data)
        }
        [CREATE_POOL, ..] => {
            log!("Instruction: CreatePool");
            create_pool(program_id, accounts)
        }
        [DEPOSIT_LIQUIDITY, data @ ..] => {
            log!("Instruction: DepositLiquidity");
            deposit_liquidity(program_id, accounts, data)
        }
        [WITHDRAW_LIQUIDITY, data @ ..] => {
            log!("Instruction: WithdrawLiquidity");
            withdraw_liquidity(program_id, accounts, data)
        }
        [SWAP_EXACT_TOKENS_FOR_TOKENS, data @ ..] => {
            log!("Instruction: SwapExactTokensForTokens");
            swap_exact_tokens_for_tokens(program_id, accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
