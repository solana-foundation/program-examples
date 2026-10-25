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
    spl_token_interface::state::Account as TokenAccountState,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct DepositLiquidityArgs {
    pub amount_a: u64,
    pub amount_b: u64,
}

pub fn process_deposit_liquidity(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: DepositLiquidityArgs,
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

    let dep_a_state = TokenAccountState::unpack(&depositor_account_a.data.borrow())?;
    let dep_b_state = TokenAccountState::unpack(&depositor_account_b.data.borrow())?;
    let pool_a_state = TokenAccountState::unpack(&pool_account_a.data.borrow())?;
    let pool_b_state = TokenAccountState::unpack(&pool_account_b.data.borrow())?;


    let mut amount_a = if args.amount_a > dep_a_state.amount { dep_a_state.amount } else { args.amount_a };
    let mut amount_b = if args.amount_b > dep_b_state.amount { dep_b_state.amount } else { args.amount_b };

    let pool_creation = pool_a_state.amount == 0 && pool_b_state.amount == 0;
    (amount_a, amount_b) = if pool_creation {
        (amount_a, amount_b)
    } else {
        let amount_a_u128 = amount_a as u128;
        let amount_b_u128 = amount_b as u128;
        let pool_a_u128 = pool_a_state.amount as u128;
        let pool_b_u128 = pool_b_state.amount as u128;

        let amount_b_required = amount_a_u128
            .checked_mul(pool_b_u128)
            .ok_or(SwapError::MathOverflow)?
            .checked_div(pool_a_u128)
            .ok_or(SwapError::MathOverflow)?;

        if amount_b_required <= amount_b_u128 {
            (amount_a, amount_b_required as u64)
        } else {
            let amount_a_required = amount_b_u128
                .checked_mul(pool_a_u128)
                .ok_or(SwapError::MathOverflow)?
                .checked_div(pool_b_u128)
                .ok_or(SwapError::MathOverflow)?;
            (amount_a_required as u64, amount_b)
        }
    };

    let mut liquidity = (amount_a as u128)
        .checked_mul(amount_b as u128)
        .ok_or(SwapError::MathOverflow)?
        .isqrt() as u64;

    if pool_creation {
        if liquidity < MINIMUM_LIQUIDITY {
            return Err(SwapError::DepositTooSmall.into());
        }
        liquidity -= MINIMUM_LIQUIDITY;
    }

    // Ensure depositor LP token account exists
    if depositor_account_liquidity.data_is_empty() {
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                depositor.key,
                mint_liquidity.key,
                token_program.key,
            ),
            &[
                payer.clone(),
                depositor_account_liquidity.clone(),
                depositor.clone(),
                mint_liquidity.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;
    }

    // Transfer token A to pool
    invoke(
        &token_instruction::transfer(
            token_program.key,
            depositor_account_a.key,
            pool_account_a.key,
            depositor.key,
            &[depositor.key],
            amount_a,
        )?,
        &[depositor_account_a.clone(), pool_account_a.clone(), depositor.clone()],
    )?;

    // Transfer token B to pool
    invoke(
        &token_instruction::transfer(
            token_program.key,
            depositor_account_b.key,
            pool_account_b.key,
            depositor.key,
            &[depositor.key],
            amount_b,
        )?,
        &[depositor_account_b.clone(), pool_account_b.clone(), depositor.clone()],
    )?;

    // Mint LP tokens to user
    let authority_seeds: &[&[u8]] = &[
        pool.amm.as_ref(),
        mint_a.key.as_ref(),
        mint_b.key.as_ref(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];

    invoke_signed(
        &token_instruction::mint_to(
            token_program.key,
            mint_liquidity.key,
            depositor_account_liquidity.key,
            pool_authority.key,
            &[pool_authority.key],
            liquidity,
        )?,
        &[mint_liquidity.clone(), depositor_account_liquidity.clone(), pool_authority.clone()],
        &[authority_seeds],
    )?;

    Ok(())
}
