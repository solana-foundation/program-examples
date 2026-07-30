//! Pure gacha logic: alpha derivation, weighted tier selection, and prize constants.
//!
//! [`select_tier`] maps a 64-byte VRF output (`beta`) to a reward tier and
//! [`derive_alpha`] binds the VRF input to buyer-supplied entropy. Both are host
//! unit-tested and mirrored byte-for-byte by the off-chain verifier in the
//! TypeScript client (`selectTier` / `pullAlpha` in `@solana/gacha`), so anyone
//! can reproduce a pull result from on-chain data and check it against the
//! recorded tier.
//!
//! Tier weights are a primitive array rather than an array of structs so the
//! layout maps cleanly through Codama to the client.

use pinocchio::Address;

use crate::GachaError;

/// Maximum number of reward tiers a pool can define.
pub const MAX_TIERS: usize = 8;

/// Human-readable rarity label per tier index, recorded in each prize NFT's
/// Token-2022 metadata under the `"rarity"` key. Tier 0 is the most common;
/// pools list tiers from highest to lowest weight by convention.
pub const RARITY_LABELS: [&str; MAX_TIERS] =
    ["common", "uncommon", "rare", "epic", "legendary", "mythic", "exotic", "divine"];

/// Prize NFT name prefix; the pull index is appended in decimal.
pub const NFT_NAME_PREFIX: &str = "Gacha Pull #";
/// Prize NFT symbol.
pub const NFT_SYMBOL: &str = "GACHA";
/// Prize NFT metadata URI.
pub const NFT_URI: &str = "https://example.com/gacha.json";

/// Derives a pull's VRF input: `SHA-256(pull_address || client_seed)`.
///
/// Binding the buyer's `client_seed` makes `alpha` unpredictable to the operator
/// before the buy transaction lands — a *fixed* alpha (like the pull address
/// alone) is not enough, because `beta = VRF(operator_key, alpha)` is
/// deterministic and an operator who can predict alpha can precompute every
/// outcome. Hashing in the pull address makes alpha unique per pull even if a
/// buyer reuses a seed.
pub fn derive_alpha(pull: &Address, client_seed: &[u8; 32]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[pull.as_ref(), client_seed]).to_bytes()
}

/// Selects a reward tier from a VRF output, weighted by the pool's fixed tier
/// weights.
///
/// The first 16 bytes of `beta` are read as a little-endian `u128` and reduced
/// modulo the total weight; the resulting target walks the tiers in order. The
/// weights never change after init, so every pull faces identical odds and the
/// outcome depends only on `beta` — never on how many other pulls exist or the
/// order in which the operator settles them.
pub fn select_tier(beta: &[u8; 64], weights: &[u32; MAX_TIERS], tier_count: u8) -> Result<u8, GachaError> {
    let count = (tier_count as usize).min(MAX_TIERS);

    let mut total: u64 = 0;
    for &weight in &weights[..count] {
        total = total.checked_add(weight as u64).ok_or(GachaError::ArithmeticOverflow)?;
    }
    if total == 0 {
        return Err(GachaError::InvalidTierConfig);
    }

    let mut seed = [0u8; 16];
    seed.copy_from_slice(&beta[..16]);
    let mut target = (u128::from_le_bytes(seed) % total as u128) as u64;

    for (i, &weight) in weights[..count].iter().enumerate() {
        let weight = weight as u64;
        if target < weight {
            return Ok(i as u8);
        }
        target -= weight;
    }

    Err(GachaError::InvalidTierConfig)
}

/// Formats `value` in decimal into `buf`, returning the used suffix of the
/// buffer. Used to build prize NFT names without `alloc`.
pub fn format_u64(value: u64, buf: &mut [u8; 20]) -> &str {
    let mut i = buf.len();
    let mut v = value;
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    // Digits are ASCII, so the slice is always valid UTF-8.
    unsafe { core::str::from_utf8_unchecked(&buf[i..]) }
}
