use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{thaw_delegated_account, MasterEditionAccount, Metadata, MetadataAccount, ThawDelegatedAccount},
    token::{revoke, Mint, Revoke, Token, TokenAccount},
};

use crate::{
    instructions::shared::{mint_reward_tokens, settle_rewards},
    NftUnstaked, StakeAccount, StakeConfig, StakeError, UserAccount, SECONDS_PER_DAY,
};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub nft_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = user,
    )]
    pub nft_token_account: Box<Account<'info, TokenAccount>>,

    // Metaplex's `Metadata` is a large struct, and this instruction carries a
    // lot of accounts. Boxing the big ones keeps them on the heap instead of
    // the (much smaller) instruction stack frame.
    #[account(
        seeds = [b"metadata", metadata_program.key().as_ref(), nft_mint.key().as_ref()],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub metadata: Box<Account<'info, MetadataAccount>>,

    #[account(
        seeds = [b"metadata", metadata_program.key().as_ref(), nft_mint.key().as_ref(), b"edition"],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub edition: Box<Account<'info, MasterEditionAccount>>,

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
    pub rewards_mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = rewards_mint,
        associated_token::authority = user,
    )]
    pub rewards_token_account: Box<Account<'info, TokenAccount>>,

    /// Closing this returns its rent to the user and, just as importantly,
    /// makes the position un-claimable afterwards — there is no checkpoint
    /// left to settle against.
    #[account(
        mut,
        close = user,
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
    pub metadata_program: Program<'info, Metadata>,
}

impl<'info> Unstake<'info> {
    pub fn unstake(&mut self) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        let staked_for = now.checked_sub(self.stake_account.staked_at).ok_or(StakeError::Overflow)?;
        let freeze_period =
            (self.config.freeze_period_days as i64).checked_mul(SECONDS_PER_DAY).ok_or(StakeError::Overflow)?;
        require!(staked_for >= freeze_period, StakeError::FreezePeriodNotPassed);

        // Pay out whatever is still owed before the position disappears, so
        // unstaking never silently forfeits earned rewards. Unlike `claim`,
        // zero is fine here — it just means nothing was outstanding.
        let points_per_day = self.config.points_per_day;
        let points = settle_rewards(&mut self.stake_account, points_per_day, now)?;
        mint_reward_tokens(&self.config, &self.rewards_mint, &self.rewards_token_account, &self.token_program, points)?;

        self.user_account.points_earned =
            self.user_account.points_earned.checked_add(points).ok_or(StakeError::Overflow)?;

        // Thaw before revoking: Metaplex requires the delegate to still be set
        // and signing, and revoking first would strip exactly that authority.
        let nft_mint_key = self.nft_mint.key();
        let config_key = self.config.key();
        let seeds = &[b"stake".as_ref(), nft_mint_key.as_ref(), config_key.as_ref(), &[self.stake_account.bump]];
        let signer_seeds = &[&seeds[..]];

        thaw_delegated_account(CpiContext::new_with_signer(
            self.metadata_program.key(),
            ThawDelegatedAccount {
                metadata: self.metadata.to_account_info(),
                delegate: self.stake_account.to_account_info(),
                token_account: self.nft_token_account.to_account_info(),
                edition: self.edition.to_account_info(),
                mint: self.nft_mint.to_account_info(),
                token_program: self.token_program.to_account_info(),
            },
            signer_seeds,
        ))?;

        revoke(CpiContext::new(
            self.token_program.key(),
            Revoke { source: self.nft_token_account.to_account_info(), authority: self.user.to_account_info() },
        ))?;

        self.user_account.amount_staked = self.user_account.amount_staked.checked_sub(1).ok_or(StakeError::Overflow)?;

        emit!(NftUnstaked { user: self.user.key(), mint: self.nft_mint.key(), final_points: points, unstaked_at: now });

        Ok(())
    }
}
