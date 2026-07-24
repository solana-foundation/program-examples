use solana_signer::Signer;

use crate::{
    tests::{asserts::TransactionResultExt, utils::*},
    GachaError,
};

#[test]
fn creates_pool_with_tiers() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let weights = [70u32, 25, 5];
    let supplies = [100u32, 50, 10];

    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &weights, &supplies).assert_ok();

    let pool = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool.tier_count, 3);
    assert_eq!(pool.entry_fee, ENTRY_FEE);
    assert_eq!(pool.pulls_count, 0);
    assert_eq!(pool.operator, operator.pubkey().to_bytes());
    assert_eq!(&pool.weights[..3], &weights);
    assert_eq!(&pool.supplies[..3], &supplies);
    assert_eq!(&pool.remaining[..3], &supplies);
}

#[test]
fn rejects_zero_tiers() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[], &[]).assert_err(GachaError::TooManyTiers);
}

#[test]
fn rejects_invalid_tier() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[0], &[10]).assert_err(GachaError::InvalidTierConfig);
}

#[test]
fn rejects_entry_fee_below_rent() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), 1, &[100], &[10]).assert_err(GachaError::InvalidEntryFee);
}

#[test]
fn rejects_duplicate_pool() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100], &[10]).assert_ok();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100], &[10]).assert_err(GachaError::PoolAlreadyExists);
}
