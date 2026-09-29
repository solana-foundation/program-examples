use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};

use crate::{StakeAccount, StakeConfig, StakeError, SECONDS_PER_DAY};

/// Settles the rewards accrued since the stake position's checkpoint, advancing
/// that checkpoint by exactly the span it pays for.
///
/// Settling and checkpointing together is what stops the same seconds being
/// paid twice; advancing by whole days rather than to `now` is what keeps the
/// leftover part-day banked for the next claim.
///
/// Zero means nothing has accrued yet: `claim` rejects it, `unstake` allows it.
pub fn settle_rewards(stake_account: &mut StakeAccount, points_per_day: u64, now: i64) -> Result<u64> {
    let elapsed = now.checked_sub(stake_account.last_claimed_at).ok_or(StakeError::Overflow)?;

    // A validator clock can step backwards across a restart.
    if elapsed <= 0 {
        return Ok(0);
    }

    let full_days = elapsed / SECONDS_PER_DAY;
    if full_days == 0 {
        return Ok(0);
    }

    let points = (full_days as u64).checked_mul(points_per_day).ok_or(StakeError::Overflow)?;
    let settled_span = full_days.checked_mul(SECONDS_PER_DAY).ok_or(StakeError::Overflow)?;

    stake_account.last_claimed_at =
        stake_account.last_claimed_at.checked_add(settled_span).ok_or(StakeError::Overflow)?;

    Ok(points)
}

/// Mints `points` reward tokens to `destination`, scaled by the reward mint's
/// decimals, with the config PDA signing as the mint authority.
pub fn mint_reward_tokens<'info>(
    config: &Account<'info, StakeConfig>,
    rewards_mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    points: u64,
) -> Result<()> {
    if points == 0 {
        return Ok(());
    }

    let amount = points
        .checked_mul(10u64.checked_pow(rewards_mint.decimals as u32).ok_or(StakeError::Overflow)?)
        .ok_or(StakeError::Overflow)?;

    // The config PDA is the reward mint's authority, so the program signs here.
    let admin = config.admin;
    let seeds = &[b"config".as_ref(), admin.as_ref(), &[config.bump]];
    let signer_seeds = &[&seeds[..]];

    mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: rewards_mint.to_account_info(),
                to: destination.to_account_info(),
                authority: config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )
}
