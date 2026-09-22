use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    instructions::shared::{mint_reward_tokens, settle_rewards},
    RewardsClaimed, StakeAccount, StakeConfig, StakeError, UserAccount,
};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        seeds = [b"config", config.admin.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StakeConfig>,

    #[account(
        mut,
        seeds = [b"rewards", config.key().as_ref()],
        bump = config.rewards_bump,
    )]
    pub rewards_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = rewards_mint,
        associated_token::authority = user,
    )]
    pub rewards_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"stake", nft_mint.key().as_ref(), config.key().as_ref()],
        bump = stake_account.bump,
        constraint = stake_account.owner == user.key() @ StakeError::InvalidOwner,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        mut,
        seeds = [b"user", config.key().as_ref(), user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Claim<'info> {
    pub fn claim(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let points_per_day = self.config.points_per_day;

        // Settling advances the checkpoint on `stake_account`. Calling this
        // instruction twice in a row therefore pays out once and then finds
        // nothing left to pay — the same seconds cannot be claimed again.
        let points = settle_rewards(&mut self.stake_account, points_per_day, now)?;
        require!(points > 0, StakeError::NothingToClaim);

        mint_reward_tokens(&self.config, &self.rewards_mint, &self.rewards_token_account, &self.token_program, points)?;

        self.user_account.points_earned =
            self.user_account.points_earned.checked_add(points).ok_or(StakeError::Overflow)?;

        emit!(RewardsClaimed {
            user: self.user.key(),
            mint: self.nft_mint.key(),
            points,
            claimed_through: self.stake_account.last_claimed_at,
        });

        Ok(())
    }
}
