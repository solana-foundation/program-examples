use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::AUTHORITY_SEED,
    errors::*,
    state::{Amm, Pool},
};

pub fn swap_exact_tokens_for_tokens(
    ctx: Context<SwapExactTokensForTokens>,
    swap_a: bool,
    input_amount: u64,
    min_output_amount: u64,
) -> Result<()> {
    // Prevent depositing assets the depositor does not own
    let input = if swap_a && input_amount > ctx.accounts.trader_account_a.amount {
        ctx.accounts.trader_account_a.amount
    } else if !swap_a && input_amount > ctx.accounts.trader_account_b.amount {
        ctx.accounts.trader_account_b.amount
    } else {
        input_amount
    };

    // Apply trading fee, used to compute the output.
    // u128 + checked math avoids overflow when input * fee approaches u64::MAX.
    let amm = &ctx.accounts.amm;
    let fee_amount = (input as u128)
        .checked_mul(amm.fee as u128)
        .ok_or(TutorialError::MathOverflow)?
        .checked_div(10000)
        .ok_or(TutorialError::MathOverflow)? as u64;
    let taxed_input = input.checked_sub(fee_amount).ok_or(TutorialError::MathOverflow)?;

    let pool_a = &ctx.accounts.pool_account_a;
    let pool_b = &ctx.accounts.pool_account_b;
    // Constant-product output, computed in u128 so taxed_input * pool amount
    // cannot overflow.
    let output = if swap_a {
        (taxed_input as u128)
            .checked_mul(pool_b.amount as u128)
            .ok_or(TutorialError::MathOverflow)?
            .checked_div((pool_a.amount as u128).checked_add(taxed_input as u128).ok_or(TutorialError::MathOverflow)?)
            .ok_or(TutorialError::MathOverflow)?
    } else {
        (taxed_input as u128)
            .checked_mul(pool_a.amount as u128)
            .ok_or(TutorialError::MathOverflow)?
            .checked_div((pool_b.amount as u128).checked_add(taxed_input as u128).ok_or(TutorialError::MathOverflow)?)
            .ok_or(TutorialError::MathOverflow)?
    } as u64;

    if output < min_output_amount {
        return err!(TutorialError::OutputTooSmall);
    }

    // Compute the invariant before the trade (u128 to avoid overflow on large pools)
    let invariant = (pool_a.amount as u128) * (pool_b.amount as u128);

    // Transfer tokens to the pool
    let authority_bump = ctx.bumps.pool_authority;
    let authority_seeds = &[
        &ctx.accounts.pool.amm.to_bytes(),
        &ctx.accounts.mint_a.key().to_bytes(),
        &ctx.accounts.mint_b.key().to_bytes(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];
    if swap_a {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.trader_account_a.to_account_info(),
                    to: ctx.accounts.pool_account_a.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            input,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.pool_account_b.to_account_info(),
                    to: ctx.accounts.trader_account_b.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer_seeds,
            ),
            output,
        )?;
    } else {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.pool_account_a.to_account_info(),
                    to: ctx.accounts.trader_account_a.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer_seeds,
            ),
            output,
        )?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.trader_account_b.to_account_info(),
                    to: ctx.accounts.pool_account_b.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            input,
        )?;
    }

    msg!(
        "Traded {} tokens ({} after fees) for {}",
        input,
        taxed_input,
        output
    );

    // Verify the invariant still holds
    // Reload accounts because of the CPIs
    // We tolerate if the new invariant is higher because it means a rounding error for LPs
    ctx.accounts.pool_account_a.reload()?;
    ctx.accounts.pool_account_b.reload()?;
    let new_invariant = (ctx.accounts.pool_account_a.amount as u128) * (ctx.accounts.pool_account_b.amount as u128);
    if invariant > new_invariant {
        return err!(TutorialError::InvariantViolated);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SwapExactTokensForTokens<'info> {
    #[account(
        seeds = [
            amm.id.as_ref()
        ],
        bump,
    )]
    pub amm: Account<'info, Amm>,

    #[account(
        seeds = [
            pool.amm.as_ref(),
            pool.mint_a.key().as_ref(),
            pool.mint_b.key().as_ref(),
        ],
        bump,
        has_one = amm,
        has_one = mint_a,
        has_one = mint_b,
    )]
    pub pool: Account<'info, Pool>,

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

    /// The account doing the swap
    pub trader: Signer<'info>,

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
        associated_token::mint = mint_a,
        associated_token::authority = trader,
    )]
    pub trader_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_b,
        associated_token::authority = trader,
    )]
    pub trader_account_b: Box<Account<'info, TokenAccount>>,

    /// The account paying for all rents
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Solana ecosystem accounts
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
