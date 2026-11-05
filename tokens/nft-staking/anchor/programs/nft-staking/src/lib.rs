pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("gphHxoVFMHZXMfapWDGtCfQhX7cjmXYcFNn5mMnJTjJ");

#[program]
pub mod nft_staking {
    use super::*;

    /// Creates the pool and its reward mint. The reward mint's authority is the
    /// config PDA, so only this program can ever mint rewards.
    pub fn initialize_config(
        context: Context<InitializeConfig>,
        points_per_day: u64,
        max_stake: u8,
        freeze_period_days: u32,
        reward_decimals: u8,
    ) -> Result<()> {
        context.accounts.initialize_config(
            points_per_day,
            max_stake,
            freeze_period_days,
            reward_decimals,
            &context.bumps,
        )
    }

    /// Creates the caller's per-user totals account. Called once per user.
    pub fn initialize_user(context: Context<InitializeUser>) -> Result<()> {
        context.accounts.initialize_user(&context.bumps)
    }

    /// Stakes an NFT by delegating its token account to a PDA and freezing it
    /// in place. The NFT never leaves the owner's wallet.
    pub fn stake(context: Context<Stake>) -> Result<()> {
        context.accounts.stake(&context.bumps)
    }

    /// Pays out the rewards accrued since the last claim, without unstaking.
    pub fn claim(context: Context<Claim>) -> Result<()> {
        context.accounts.claim()
    }

    /// Settles any outstanding rewards, thaws and un-delegates the NFT, and
    /// closes the stake position.
    pub fn unstake(context: Context<Unstake>) -> Result<()> {
        context.accounts.unstake()
    }
}
