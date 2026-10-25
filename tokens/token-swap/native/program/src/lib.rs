mod constants;
mod error;
mod instructions;
mod state;

use {
    borsh::{BorshDeserialize, BorshSerialize},
    instructions::*,
    solana_program::{
        account_info::AccountInfo,
        entrypoint,
        entrypoint::ProgramResult,
        pubkey::Pubkey,
    },
};

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = TokenSwapInstruction::try_from_slice(instruction_data)?;

    match instruction {
        TokenSwapInstruction::CreateAmm(args) => {
            process_create_amm(program_id, accounts, args)
        }
        TokenSwapInstruction::CreatePool => {
            process_create_pool(program_id, accounts)
        }
        TokenSwapInstruction::DepositLiquidity(args) => {
            process_deposit_liquidity(program_id, accounts, args)
        }
        TokenSwapInstruction::WithdrawLiquidity(args) => {
            process_withdraw_liquidity(program_id, accounts, args)
        }
        TokenSwapInstruction::SwapExactTokensForTokens(args) => {
            process_swap_exact_tokens_for_tokens(program_id, accounts, args)
        }
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum TokenSwapInstruction {
    CreateAmm(CreateAmmArgs),
    CreatePool,
    DepositLiquidity(DepositLiquidityArgs),
    WithdrawLiquidity(WithdrawLiquidityArgs),
    SwapExactTokensForTokens(SwapExactTokensForTokensArgs),
}
