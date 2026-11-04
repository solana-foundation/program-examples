use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};

use crate::{
    constants::{AUTHORITY_SEED, LIQUIDITY_SEED, MINIMUM_LIQUIDITY},
    errors::TutorialError,
    state::Pool,
};

pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount_a: u64, amount_b: u64) -> Result<()> {
    // Prevent depositing assets the depositor does not own
    let mut amount_a = if amount_a > ctx.accounts.depositor_account_a.amount {
        ctx.accounts.depositor_account_a.amount
    } else {
        amount_a
    };
    let mut amount_b = if amount_b > ctx.accounts.depositor_account_b.amount {
        ctx.accounts.depositor_account_b.amount
    } else {
        amount_b
    };

    // Making sure they are provided in the same proportion as existing liquidity
    let pool_a = &ctx.accounts.pool_account_a;
    let pool_b = &ctx.accounts.pool_account_b;
    // Defining pool creation like this allows attackers to frontrun pool creation with bad ratios
    let pool_creation = pool_a.amount == 0 && pool_b.amount == 0;
    (amount_a, amount_b) = if pool_creation {
        // Add as is if there is no liquidity
        (amount_a, amount_b)
    } else {
        require!(pool_a.amount > 0 && pool_b.amount > 0, TutorialError::DepositTooSmall);
        // u128 is enough precision here
        let amount_a_u128 = amount_a as u128;
        let amount_b_u128 = amount_b as u128;
        let pool_a_u128 = pool_a.amount as u128;
        let pool_b_u128 = pool_b.amount as u128;

        // Calculate the amount of B required if we deposit all of A provided
        let amount_b_required = amount_a_u128.checked_mul(pool_b_u128).unwrap().checked_div(pool_a_u128).unwrap();

        if amount_b_required <= amount_b_u128 {
            // We have enough B to match the A provided
            (amount_a, amount_b_required as u64)
        } else {
            // We don't have enough B, so we must limit by B and calculate A required
            let amount_a_required = amount_b_u128.checked_mul(pool_a_u128).unwrap().checked_div(pool_b_u128).unwrap();
            (amount_a_required as u64, amount_b)
        }
    };

    let liquidity = if pool_creation {
        // The initial share supply is the geometric mean, less the locked minimum.
        let initial = ((amount_a as u128) * (amount_b as u128)).isqrt() as u64;
        initial.checked_sub(MINIMUM_LIQUIDITY).ok_or(TutorialError::DepositTooSmall)?
    } else {
        // Withdrawal accounts for the unminted locked minimum as part of supply.
        // Limit shares by both actual deposits so rounding cannot dilute existing LPs.
        let supply = ctx.accounts.mint_liquidity.supply as u128 + MINIMUM_LIQUIDITY as u128;
        let shares_a = (amount_a as u128)
            .checked_mul(supply)
            .ok_or(TutorialError::MathOverflow)?
            .checked_div(pool_a.amount as u128)
            .ok_or(TutorialError::MathOverflow)?;
        let shares_b = (amount_b as u128)
            .checked_mul(supply)
            .ok_or(TutorialError::MathOverflow)?
            .checked_div(pool_b.amount as u128)
            .ok_or(TutorialError::MathOverflow)?;
        u64::try_from(shares_a.min(shares_b)).map_err(|_| TutorialError::MathOverflow)?
    };
    require!(liquidity > 0, TutorialError::DepositTooSmall);

    // Transfer tokens to the pool
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.depositor_account_a.to_account_info(),
                to: ctx.accounts.pool_account_a.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount_a,
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.depositor_account_b.to_account_info(),
                to: ctx.accounts.pool_account_b.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount_b,
    )?;

    // Mint the liquidity to user
    let authority_bump = ctx.bumps.pool_authority;
    let authority_seeds = &[
        &ctx.accounts.pool.amm.to_bytes(),
        &ctx.accounts.mint_a.key().to_bytes(),
        &ctx.accounts.mint_b.key().to_bytes(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint_liquidity.to_account_info(),
                to: ctx.accounts.depositor_account_liquidity.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            signer_seeds,
        ),
        liquidity,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(
        seeds = [
            pool.amm.as_ref(),
            pool.mint_a.key().as_ref(),
            pool.mint_b.key().as_ref(),
        ],
        bump,
        has_one = mint_a,
        has_one = mint_b,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Read only authority
    #[account(
        seeds = [
            pool.amm.as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            AUTHORITY_SEED,
        ],
        bump,
    )]
    pub pool_authority: AccountInfo<'info>,

    /// The account paying for all rents
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [
            pool.amm.as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            LIQUIDITY_SEED,
        ],
        bump,
    )]
    pub mint_liquidity: Box<Account<'info, Mint>>,

    pub mint_a: Box<Account<'info, Mint>>,

    pub mint_b: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = pool_authority,
    )]
    pub pool_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = pool_authority,
    )]
    pub pool_account_b: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_liquidity,
        associated_token::authority = depositor,
    )]
    pub depositor_account_liquidity: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = depositor,
    )]
    pub depositor_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = depositor,
    )]
    pub depositor_account_b: Box<Account<'info, TokenAccount>>,

    /// The account paying for all rents
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Solana ecosystem accounts
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
