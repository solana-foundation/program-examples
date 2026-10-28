pub const ANCHOR_DISCRIMINATOR: usize = 8;

/// Rewards accrue per whole day staked.
pub const SECONDS_PER_DAY: i64 = 86_400;

/// The most decimals a pool may give its reward mint, matching the SPL convention.
pub const MAX_REWARD_DECIMALS: u8 = 9;

/// A pool must stay solvent in `u64` for at least this long. `unstake` pays out
/// before it thaws, so a reward rate that can overflow would strand the NFT
/// frozen with no way to recover it — the bound is enforced at config time.
pub const MAX_ACCRUAL_DAYS: u64 = 365 * 100;
