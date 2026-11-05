use anchor_lang::prelude::*;

/// Per-user totals within one pool, at seeds `["user", config, user]`.
/// Created once per pool and reused across every NFT that user stakes there.
#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    /// Lifetime points paid out to this user in this pool, across all their
    /// stake positions in it.
    /// A running total for display; the authoritative per-NFT accrual state
    /// lives on each `StakeAccount`.
    pub points_earned: u64,
    /// How many NFTs this user currently has staked in this pool, checked
    /// against `StakeConfig::max_stake`.
    pub amount_staked: u8,
    pub bump: u8,
}
