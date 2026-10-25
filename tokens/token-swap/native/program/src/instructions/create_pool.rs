use {
    crate::{constants::*, error::*, state::*},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        program_pack::Pack,
        pubkey::Pubkey,
        rent::Rent,
        sysvar::Sysvar,
    },
    solana_system_interface::instruction as system_instruction,
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::instruction as token_instruction,
    spl_token_interface::state::Mint as MintState,
};

pub fn process_create_pool(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let amm_account = next_account_info(accounts_iter)?;
    let pool_account = next_account_info(accounts_iter)?;
    let pool_authority = next_account_info(accounts_iter)?;
    let mint_liquidity = next_account_info(accounts_iter)?;
    let mint_a = next_account_info(accounts_iter)?;
    let mint_b = next_account_info(accounts_iter)?;
    let pool_account_a = next_account_info(accounts_iter)?;
    let pool_account_b = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let associated_token_program = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if mint_a.key == mint_b.key {
        return Err(SwapError::InvalidMint.into());
    }

    // Verify Pool PDA
    let (expected_pool_key, pool_bump) = Pubkey::find_program_address(
        &[amm_account.key.as_ref(), mint_a.key.as_ref(), mint_b.key.as_ref()],
        program_id,
    );
    if expected_pool_key != *pool_account.key {
        return Err(SwapError::AccountMismatch.into());
    }

    // Verify Pool Authority PDA
    let (expected_authority_key, _authority_bump) = Pubkey::find_program_address(
        &[amm_account.key.as_ref(), mint_a.key.as_ref(), mint_b.key.as_ref(), AUTHORITY_SEED],
        program_id,
    );
    if expected_authority_key != *pool_authority.key {
        return Err(SwapError::AccountMismatch.into());
    }

    // Verify Mint Liquidity PDA
    let (expected_mint_liquidity, mint_bump) = Pubkey::find_program_address(
        &[amm_account.key.as_ref(), mint_a.key.as_ref(), mint_b.key.as_ref(), LIQUIDITY_SEED],
        program_id,
    );
    if expected_mint_liquidity != *mint_liquidity.key {
        return Err(SwapError::AccountMismatch.into());
    }

    let rent = Rent::get()?;

    // 1. Create Pool Account
    let pool_lamports = rent.minimum_balance(Pool::LEN);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            pool_account.key,
            pool_lamports,
            Pool::LEN as u64,
            program_id,
        ),
        &[payer.clone(), pool_account.clone()],
        &[&[
            amm_account.key.as_ref(),
            mint_a.key.as_ref(),
            mint_b.key.as_ref(),
            &[pool_bump],
        ]],
    )?;

    let pool = Pool {
        amm: *amm_account.key,
        mint_a: *mint_a.key,
        mint_b: *mint_b.key,
    };
    use borsh::BorshSerialize;
    pool.serialize(&mut &mut pool_account.data.borrow_mut()[..])?;

    // 2. Create LP Token Mint (Decimals: 6, Authority: pool_authority)
    let mint_len = MintState::LEN;
    let mint_lamports = rent.minimum_balance(mint_len);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            mint_liquidity.key,
            mint_lamports,
            mint_len as u64,
            token_program.key,
        ),
        &[payer.clone(), mint_liquidity.clone()],
        &[&[
            amm_account.key.as_ref(),
            mint_a.key.as_ref(),
            mint_b.key.as_ref(),
            LIQUIDITY_SEED,
            &[mint_bump],
        ]],
    )?;

    invoke(
        &token_instruction::initialize_mint2(
            token_program.key,
            mint_liquidity.key,
            pool_authority.key,
            None,
            6,
        )?,
        &[mint_liquidity.clone()],
    )?;

    // 3. Create Associated Token Accounts for Pool (A and B)
    invoke(
        &associated_token_account_instruction::create_associated_token_account(
            payer.key,
            pool_authority.key,
            mint_a.key,
            token_program.key,
        ),
        &[
            payer.clone(),
            pool_account_a.clone(),
            pool_authority.clone(),
            mint_a.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;

    invoke(
        &associated_token_account_instruction::create_associated_token_account(
            payer.key,
            pool_authority.key,
            mint_b.key,
            token_program.key,
        ),
        &[
            payer.clone(),
            pool_account_b.clone(),
            pool_authority.clone(),
            mint_b.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;

    Ok(())
}
