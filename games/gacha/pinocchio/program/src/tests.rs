//! Host unit tests for the pure gacha selection logic.

use crate::{
    gacha::{select_tier, MAX_TIERS},
    GachaError,
};

/// Copies `vals` into a fixed-length tier array, zero-padding the rest.
fn arr(vals: &[u32]) -> [u32; MAX_TIERS] {
    let mut a = [0u32; MAX_TIERS];
    a[..vals.len()].copy_from_slice(vals);
    a
}

/// Builds a `beta` whose first 16 bytes encode `value` as a little-endian u128.
fn beta_from(value: u128) -> [u8; 64] {
    let mut beta = [0u8; 64];
    beta[..16].copy_from_slice(&value.to_le_bytes());
    beta
}

#[test]
fn selects_tier_by_weight_bucket() {
    // Weights 60 / 30 / 10, total 100, all in stock.
    let weights = arr(&[60, 30, 10]);
    let remaining = arr(&[5, 5, 5]);

    assert_eq!(select_tier(&beta_from(0), &weights, &remaining, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(59), &weights, &remaining, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(60), &weights, &remaining, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(89), &weights, &remaining, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(90), &weights, &remaining, 3).unwrap(), 2);
    assert_eq!(select_tier(&beta_from(99), &weights, &remaining, 3).unwrap(), 2);
}

#[test]
fn wraps_via_modulo() {
    let weights = arr(&[60, 30, 10]);
    let remaining = arr(&[5, 5, 5]);
    // 100 % 100 == 0 -> tier 0; 190 % 100 == 90 -> tier 2.
    assert_eq!(select_tier(&beta_from(100), &weights, &remaining, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(190), &weights, &remaining, 3).unwrap(), 2);
}

#[test]
fn skips_exhausted_tiers() {
    // Tier 0 has no remaining supply; total available weight is 30 + 10 = 40.
    let weights = arr(&[60, 30, 10]);
    let remaining = arr(&[0, 5, 5]);
    assert_eq!(select_tier(&beta_from(0), &weights, &remaining, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(29), &weights, &remaining, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(30), &weights, &remaining, 3).unwrap(), 2);
}

#[test]
fn respects_tier_count() {
    // Only the first two tiers are active even though a third is present.
    let weights = arr(&[60, 40, 10]);
    let remaining = arr(&[5, 5, 5]);
    assert_eq!(select_tier(&beta_from(99), &weights, &remaining, 2).unwrap(), 1);
}

#[test]
fn errors_when_fully_exhausted() {
    let weights = arr(&[60, 30, 10]);
    let remaining = arr(&[0, 0, 0]);
    assert!(matches!(select_tier(&beta_from(0), &weights, &remaining, 3), Err(GachaError::PoolExhausted)));
}
