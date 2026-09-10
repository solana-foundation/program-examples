use anchor_lang::prelude::*;

/// Pool-wide settings. One per program, at seeds `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct StakeConfig {
    pub admin: Pubkey,
    /// Only NFTs whose verified collection matches this mint may be staked.
    pub collection: Pubkey,
    /// Reward points earned per NFT, per whole day staked.
    pub points_per_day: u64,
    /// How many NFTs one user may stake at once.
    pub max_stake: u8,
    /// How long an NFT must stay staked before it can be unstaked.
    pub freeze_period_days: u32,
    pub rewards_bump: u8,
    pub bump: u8,
}
