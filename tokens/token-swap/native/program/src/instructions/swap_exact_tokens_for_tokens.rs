use {
    crate::{constants::*, error::*, state::*},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        msg,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        program_pack::Pack,
        pubkey::Pubkey,
    },
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::instruction as token_instruction,
    spl_token_interface::state::Account as TokenAccountState,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct SwapExactTokensForTokensArgs {
    pub swap_a: bool,
    pub input_amount: u64,
    pub min_output_amount: u64,
}

pub fn process_swap_exact_tokens_for_tokens(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: SwapExactTokensForTokensArgs,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let amm_account = next_account_info(accounts_iter)?;
    let pool_account = next_account_info(accounts_iter)?;
    let pool_authority = next_account_info(accounts_iter)?;
    let trader = next_account_info(accounts_iter)?;
    let mint_a = next_account_info(accounts_iter)?;
    let mint_b = next_account_info(accounts_iter)?;
    let pool_account_a = next_account_info(accounts_iter)?;
    let pool_account_b = next_account_info(accounts_iter)?;
    let trader_account_a = next_account_info(accounts_iter)?;
    let trader_account_b = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let associated_token_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !trader.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amm = Amm::try_from_slice(&amm_account.data.borrow())?;
    let pool = Pool::try_from_slice(&pool_account.data.borrow())?;

    if pool.amm != *amm_account.key || pool.mint_a != *mint_a.key || pool.mint_b != *mint_b.key {
        return Err(SwapError::AccountMismatch.into());
    }

    let (expected_authority_key, authority_bump) = Pubkey::find_program_address(
        &[pool.amm.as_ref(), mint_a.key.as_ref(), mint_b.key.as_ref(), AUTHORITY_SEED],
        program_id,
    );
    if expected_authority_key != *pool_authority.key {
        return Err(SwapError::AccountMismatch.into());
    }

    let pool_a_state = TokenAccountState::unpack(&pool_account_a.data.borrow())?;
    let pool_b_state = TokenAccountState::unpack(&pool_account_b.data.borrow())?;

    let input = if args.swap_a {
        let trader_a_state = TokenAccountState::unpack(&trader_account_a.data.borrow())?;
        if args.input_amount > trader_a_state.amount {
            trader_a_state.amount
        } else {
            args.input_amount
        }
    } else {
        let trader_b_state = TokenAccountState::unpack(&trader_account_b.data.borrow())?;
        if args.input_amount > trader_b_state.amount {
            trader_b_state.amount
        } else {
            args.input_amount
        }
    };

    let fee_amount = (input as u128)
        .checked_mul(amm.fee as u128)
        .ok_or(SwapError::MathOverflow)?
        .checked_div(10000)
        .ok_or(SwapError::MathOverflow)? as u64;
    let taxed_input = input.checked_sub(fee_amount).ok_or(SwapError::MathOverflow)?;

    let output = if args.swap_a {
        (taxed_input as u128)
            .checked_mul(pool_b_state.amount as u128)
            .ok_or(SwapError::MathOverflow)?
            .checked_div(
                (pool_a_state.amount as u128)
                    .checked_add(taxed_input as u128)
                    .ok_or(SwapError::MathOverflow)?,
            )
            .ok_or(SwapError::MathOverflow)?
    } else {
        (taxed_input as u128)
            .checked_mul(pool_a_state.amount as u128)
            .ok_or(SwapError::MathOverflow)?
            .checked_div(
                (pool_b_state.amount as u128)
                    .checked_add(taxed_input as u128)
                    .ok_or(SwapError::MathOverflow)?,
            )
            .ok_or(SwapError::MathOverflow)?
    } as u64;

    if output < args.min_output_amount {
        return Err(SwapError::OutputTooSmall.into());
    }

    let invariant = (pool_a_state.amount as u128) * (pool_b_state.amount as u128);

    // Ensure output token account exists for trader
    let target_out_account = if args.swap_a { trader_account_b } else { trader_account_a };
    let target_mint = if args.swap_a { mint_b } else { mint_a };
    if target_out_account.data_is_empty() {
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                trader.key,
                target_mint.key,
                token_program.key,
            ),
            &[
                payer.clone(),
                target_out_account.clone(),
                trader.clone(),
                target_mint.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;
    }

    let authority_seeds: &[&[u8]] = &[
        pool.amm.as_ref(),
        mint_a.key.as_ref(),
        mint_b.key.as_ref(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];

    if args.swap_a {
        invoke(
            &token_instruction::transfer(
                token_program.key,
                trader_account_a.key,
                pool_account_a.key,
                trader.key,
                &[trader.key],
                input,
            )?,
            &[trader_account_a.clone(), pool_account_a.clone(), trader.clone()],
        )?;
        invoke_signed(
            &token_instruction::transfer(
                token_program.key,
                pool_account_b.key,
                trader_account_b.key,
                pool_authority.key,
                &[pool_authority.key],
                output,
            )?,
            &[pool_account_b.clone(), trader_account_b.clone(), pool_authority.clone()],
            &[authority_seeds],
        )?;
    } else {
        invoke_signed(
            &token_instruction::transfer(
                token_program.key,
                pool_account_a.key,
                trader_account_a.key,
                pool_authority.key,
                &[pool_authority.key],
                output,
            )?,
            &[pool_account_a.clone(), trader_account_a.clone(), pool_authority.clone()],
            &[authority_seeds],
        )?;
        invoke(
            &token_instruction::transfer(
                token_program.key,
                trader_account_b.key,
                pool_account_b.key,
                trader.key,
                &[trader.key],
                input,
            )?,
            &[trader_account_b.clone(), pool_account_b.clone(), trader.clone()],
        )?;
    }

    msg!("Traded {} tokens ({} after fees) for {}", input, taxed_input, output);

    // Verify invariant holds after transfer
    let new_pool_a = TokenAccountState::unpack(&pool_account_a.data.borrow())?;
    let new_pool_b = TokenAccountState::unpack(&pool_account_b.data.borrow())?;
    let new_invariant = (new_pool_a.amount as u128) * (new_pool_b.amount as u128);

    if invariant > new_invariant {
        return Err(SwapError::InvariantViolated.into());
    }

    Ok(())
}
