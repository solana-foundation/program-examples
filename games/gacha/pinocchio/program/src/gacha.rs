//! Pure gacha logic: the deterministic weighted tier selection.
//!
//! [`select_tier`] maps a 64-byte VRF output (`beta`) to a reward tier. It is
//! host unit-tested and mirrored byte-for-byte by the off-chain verifier in the
//! TypeScript client (`selectTier` in `@solana/gacha`), so anyone can reproduce a
//! pull result from the on-chain `beta` and check it against the recorded tier.
//!
//! Tiers are stored as parallel primitive arrays (`weights` / `remaining`) rather
//! than an array of structs so the layout maps cleanly through Codama to the client.

use crate::GachaError;

/// Maximum number of reward tiers a pool can define.
pub const MAX_TIERS: usize = 8;

/// Selects a reward tier from a VRF output, weighted by each tier's weight and
/// restricted to tiers with remaining supply.
///
/// The first 16 bytes of `beta` are read as a little-endian `u128` and reduced
/// modulo the total available weight; the resulting target walks the tiers in order.
/// Tiers with zero remaining supply are skipped so odds always reflect live supply.
/// Returns [`GachaError::PoolExhausted`] when no tier has remaining supply.
pub fn select_tier(
    beta: &[u8; 64],
    weights: &[u32; MAX_TIERS],
    remaining: &[u32; MAX_TIERS],
    tier_count: u8,
) -> Result<u8, GachaError> {
    let count = (tier_count as usize).min(MAX_TIERS);

    let mut total: u64 = 0;
    for i in 0..count {
        if remaining[i] > 0 {
            total = total.checked_add(weights[i] as u64).ok_or(GachaError::ArithmeticOverflow)?;
        }
    }
    if total == 0 {
        return Err(GachaError::PoolExhausted);
    }

    let mut seed = [0u8; 16];
    seed.copy_from_slice(&beta[..16]);
    let mut target = (u128::from_le_bytes(seed) % total as u128) as u64;

    for i in 0..count {
        if remaining[i] == 0 {
            continue;
        }
        let weight = weights[i] as u64;
        if target < weight {
            return Ok(i as u8);
        }
        target -= weight;
    }

    Err(GachaError::PoolExhausted)
}
