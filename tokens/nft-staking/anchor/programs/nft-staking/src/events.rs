use anchor_lang::prelude::*;

/// Emitted by every state-changing instruction so indexers can follow a pool
/// from transaction logs instead of polling every stake account.
#[event]
pub struct NftStaked {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub staked_at: i64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub points: u64,
    /// The checkpoint after this claim: rewards are paid up to (not past) here.
    pub claimed_through: i64,
}

#[event]
pub struct NftUnstaked {
    pub user: Pubkey,
    pub mint: Pubkey,
    /// Rewards settled by the unstake itself, on top of any earlier claims.
    pub final_points: u64,
    pub unstaked_at: i64,
}
