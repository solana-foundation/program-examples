use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::{StakeConfig, StakeError, ANCHOR_DISCRIMINATOR, MAX_ACCRUAL_DAYS, MAX_REWARD_DECIMALS};

#[derive(Accounts)]
#[instruction(points_per_day: u64, max_stake: u8, freeze_period_days: u32, reward_decimals: u8)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The collection every staked NFT must belong to.
    pub collection_mint: Account<'info, Mint>,

    /// Seeded by `admin`, so pools are per-operator. A single `["config"]`
    /// address would be a land grab: whoever called first would own the only
    /// pool the program can ever have.
    #[account(
        init,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR + StakeConfig::INIT_SPACE,
        seeds = [b"config", admin.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StakeConfig>,

    /// The reward token. Its mint authority is the config PDA, so rewards can
    /// only ever be minted by this program, from `claim` and `unstake`.
    #[account(
        init,
        payer = admin,
        seeds = [b"rewards", config.key().as_ref()],
        bump,
        mint::decimals = reward_decimals,
        mint::authority = config,
    )]
    pub rewards_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

impl<'info> InitializeConfig<'info> {
    pub fn initialize_config(
        &mut self,
        points_per_day: u64,
        max_stake: u8,
        freeze_period_days: u32,
        reward_decimals: u8,
        bumps: &InitializeConfigBumps,
    ) -> Result<()> {
        require!(max_stake > 0, StakeError::InvalidConfig);
        require!(reward_decimals <= MAX_REWARD_DECIMALS, StakeError::InvalidConfig);

        // `unstake` settles rewards before it thaws the NFT, so a rate that can
        // overflow would leave the NFT frozen with no way out. Reject any pool
        // whose payout cannot survive `MAX_ACCRUAL_DAYS` of accrual.
        require!(
            points_per_day
                .checked_mul(10u64.pow(reward_decimals as u32))
                .and_then(|scaled| scaled.checked_mul(MAX_ACCRUAL_DAYS))
                .is_some(),
            StakeError::InvalidConfig
        );

        self.config.set_inner(StakeConfig {
            admin: self.admin.key(),
            collection: self.collection_mint.key(),
            points_per_day,
            max_stake,
            freeze_period_days,
            rewards_bump: bumps.rewards_mint,
            bump: bumps.config,
        });

        Ok(())
    }
}
