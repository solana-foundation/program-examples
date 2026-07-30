//! Host unit tests for the pure gacha logic: tier selection, alpha derivation,
//! and name formatting.

use pinocchio::Address;

use crate::{
    gacha::{derive_alpha, format_u64, select_tier, MAX_TIERS},
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
    // Weights 60 / 30 / 10, total 100.
    let weights = arr(&[60, 30, 10]);

    assert_eq!(select_tier(&beta_from(0), &weights, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(59), &weights, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(60), &weights, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(89), &weights, 3).unwrap(), 1);
    assert_eq!(select_tier(&beta_from(90), &weights, 3).unwrap(), 2);
    assert_eq!(select_tier(&beta_from(99), &weights, 3).unwrap(), 2);
}

#[test]
fn wraps_via_modulo() {
    let weights = arr(&[60, 30, 10]);
    // 100 % 100 == 0 -> tier 0; 190 % 100 == 90 -> tier 2.
    assert_eq!(select_tier(&beta_from(100), &weights, 3).unwrap(), 0);
    assert_eq!(select_tier(&beta_from(190), &weights, 3).unwrap(), 2);
}

#[test]
fn respects_tier_count() {
    // Only the first two tiers are active even though a third is present.
    let weights = arr(&[60, 40, 10]);
    assert_eq!(select_tier(&beta_from(99), &weights, 2).unwrap(), 1);
}

#[test]
fn errors_on_zero_total_weight() {
    let weights = arr(&[0, 0, 0]);
    assert!(matches!(select_tier(&beta_from(0), &weights, 3), Err(GachaError::InvalidTierConfig)));
}

/// Pinned cross-language fixture: the TypeScript client's `pullAlpha` test uses
/// the same inputs and digest, keeping the two implementations byte-identical.
#[test]
fn derive_alpha_matches_pinned_fixture() {
    let pull = Address::from([1u8; 32]);
    let seed = [2u8; 32];
    let expected: [u8; 32] = [
        0xf8, 0x18, 0xaf, 0xd3, 0x7a, 0x6d, 0xc3, 0xbc, 0x92, 0xfb, 0x44, 0x73, 0x10, 0x11, 0x27, 0x70, 0x06, 0xdb,
        0x4e, 0xfa, 0x6e, 0x90, 0x23, 0xcd, 0x74, 0x68, 0xc0, 0x23, 0x35, 0xd2, 0x2a, 0x4d,
    ];
    assert_eq!(derive_alpha(&pull, &seed), expected);
}

#[test]
fn derive_alpha_depends_on_both_inputs() {
    let pull = Address::from([1u8; 32]);
    let base = derive_alpha(&pull, &[2u8; 32]);
    assert_ne!(derive_alpha(&pull, &[3u8; 32]), base);
    assert_ne!(derive_alpha(&Address::from([9u8; 32]), &[2u8; 32]), base);
}

#[test]
fn formats_u64_decimal() {
    let mut buf = [0u8; 20];
    assert_eq!(format_u64(0, &mut buf), "0");
    let mut buf = [0u8; 20];
    assert_eq!(format_u64(42, &mut buf), "42");
    let mut buf = [0u8; 20];
    assert_eq!(format_u64(u64::MAX, &mut buf), "18446744073709551615");
}
