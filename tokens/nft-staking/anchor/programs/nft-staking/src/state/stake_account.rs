use anchor_lang::prelude::*;

/// One staked NFT, at seeds `["stake", nft_mint, config]`.
///
/// This account is also the SPL delegate for the staked NFT's token account,
/// which is what lets the program freeze and thaw it while it stays in the
/// owner's wallet.
#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub staked_at: i64,
    /// The accrual checkpoint: rewards have been paid out up to this instant.
    ///
    /// Every payout advances it by exactly the time it paid for, so the same
    /// seconds can never be claimed twice. See `instructions::shared`.
    pub last_claimed_at: i64,
    pub bump: u8,
}
