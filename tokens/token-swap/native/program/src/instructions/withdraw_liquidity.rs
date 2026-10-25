use {
    crate::{constants::*, error::*, state::*},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        program_pack::Pack,
        pubkey::Pubkey,
    },
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::instruction as token_instruction,
    spl_token_interface::state::{Account as TokenAccountState, Mint as MintState},
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WithdrawLiquidityArgs {
    pub amount: u64,
}

pub fn process_withdraw_liquidity(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: WithdrawLiquidityArgs,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let pool_account = next_account_info(accounts_iter)?;
    let pool_authority = next_account_info(accounts_iter)?;
    let depositor = next_account_info(accounts_iter)?;
    let mint_liquidity = next_account_info(accounts_iter)?;
    let mint_a = next_account_info(accounts_iter)?;
    let mint_b = next_account_info(accounts_iter)?;
    let pool_account_a = next_account_info(accounts_iter)?;
    let pool_account_b = next_account_info(accounts_iter)?;
    let depositor_account_liquidity = next_account_info(accounts_iter)?;
    let depositor_account_a = next_account_info(accounts_iter)?;
    let depositor_account_b = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let associated_token_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !depositor.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let pool = Pool::try_from_slice(&pool_account.data.borrow())?;
    if pool.mint_a != *mint_a.key || pool.mint_b != *mint_b.key {
        return Err(SwapError::AccountMismatch.into());
    }

    let (expected_authority_key, authority_bump) = Pubkey::find_program_address(
        &[pool.amm.as_ref(), mint_a.key.as_ref(), mint_b.key.as_ref(), AUTHORITY_SEED],
        program_id,
    );
    if expected_authority_key != *pool_authority.key {
        return Err(SwapError::AccountMismatch.into());
    }

    let dep_lp_state = TokenAccountState::unpack(&depositor_account_liquidity.data.borrow())?;
    let pool_a_state = TokenAccountState::unpack(&pool_account_a.data.borrow())?;
    let pool_b_state = TokenAccountState::unpack(&pool_account_b.data.borrow())?;
    let mint_lp_state = MintState::unpack(&mint_liquidity.data.borrow())?;

    let amount = if args.amount > dep_lp_state.amount { dep_lp_state.amount } else { args.amount };
    let amount_u128 = amount as u128;
    let pool_mint_supply_u128 = mint_lp_state.supply as u128;

    let amount_a = amount_u128
        .checked_mul(pool_a_state.amount as u128)
        .ok_or(SwapError::MathOverflow)?
        .checked_div(pool_mint_supply_u128)
        .ok_or(SwapError::MathOverflow)? as u64;

    let amount_b = amount_u128
        .checked_mul(pool_b_state.amount as u128)
        .ok_or(SwapError::MathOverflow)?
        .checked_div(pool_mint_supply_u128)
        .ok_or(SwapError::MathOverflow)? as u64;

    // Burn user's LP tokens
    invoke(
        &token_instruction::burn(
            token_program.key,
            depositor_account_liquidity.key,
            mint_liquidity.key,
            depositor.key,
            &[depositor.key],
            amount,
        )?,
        &[depositor_account_liquidity.clone(), mint_liquidity.clone(), depositor.clone()],
    )?;

    // Ensure user token accounts exist
    if depositor_account_a.data_is_empty() {
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                depositor.key,
                mint_a.key,
                token_program.key,
            ),
            &[
                payer.clone(),
                depositor_account_a.clone(),
                depositor.clone(),
                mint_a.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;
    }

    if depositor_account_b.data_is_empty() {
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                depositor.key,
                mint_b.key,
                token_program.key,
            ),
            &[
                payer.clone(),
                depositor_account_b.clone(),
                depositor.clone(),
                mint_b.clone(),
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

    // Transfer token A from pool to user
    invoke_signed(
        &token_instruction::transfer(
            token_program.key,
            pool_account_a.key,
            depositor_account_a.key,
            pool_authority.key,
            &[pool_authority.key],
            amount_a,
        )?,
        &[pool_account_a.clone(), depositor_account_a.clone(), pool_authority.clone()],
        &[authority_seeds],
    )?;

    // Transfer token B from pool to user
    invoke_signed(
        &token_instruction::transfer(
            token_program.key,
            pool_account_b.key,
            depositor_account_b.key,
            pool_authority.key,
            &[pool_authority.key],
            amount_b,
        )?,
        &[pool_account_b.clone(), depositor_account_b.clone(), pool_authority.clone()],
        &[authority_seeds],
    )?;

    Ok(())
}
