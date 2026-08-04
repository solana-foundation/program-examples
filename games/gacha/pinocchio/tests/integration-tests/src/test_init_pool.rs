use solana_address::Address;
use solana_signer::Signer;

use crate::{
    client,
    tests::{asserts::TransactionResultExt, utils::*},
    GachaError,
};

#[test]
fn creates_pool() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let weights = [70u32, 25, 5];

    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &weights).assert_ok();

    let pool = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool.tier_count, 3);
    assert_eq!(pool.admin, admin.pubkey().to_bytes());
    assert_eq!(pool.operator, operator.pubkey().to_bytes());
    assert_eq!(pool.authority_label, AUTHORITY_LABEL);
    assert_eq!(pool.entry_fee, ENTRY_FEE);
    assert_eq!(pool.settle_deadline_slots, SETTLE_DEADLINE);
    assert_eq!(pool.pulls_count, 0);
    assert_eq!(pool.pending_pulls, 0);
    assert_eq!(&pool.weights[..3], &weights);
    assert_eq!(&pool.weights[3..], &[0u32; 5]);
}

#[test]
fn rejects_zero_tiers() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[]).assert_err(GachaError::TooManyTiers);
}

#[test]
fn rejects_zero_weight() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 0]).assert_err(GachaError::InvalidTierConfig);
}

#[test]
fn rejects_zero_entry_fee() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), 0, &[100]).assert_err(GachaError::InvalidEntryFee);
}

#[test]
fn rejects_zero_deadline() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool_with_deadline(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, 0, &[100])
        .assert_err(GachaError::InvalidSettleDeadline);
}

#[test]
fn rejects_zero_operator() {
    let (mut svm, admin) = setup();
    init_pool(&mut svm, &admin, &Address::default(), ENTRY_FEE, &[100]).assert_err(GachaError::InvalidOperator);
}

#[test]
fn rejects_operator_equal_admin() {
    let (mut svm, admin) = setup();
    init_pool(&mut svm, &admin, &admin.pubkey(), ENTRY_FEE, &[100]).assert_err(GachaError::InvalidOperator);
}

#[test]
fn rejects_off_curve_operator() {
    let (mut svm, admin) = setup();
    let (off_curve, _) = client::Vault::find_pda(&admin.pubkey());
    init_pool(&mut svm, &admin, &off_curve, ENTRY_FEE, &[100]).assert_err(GachaError::InvalidOperator);
}

#[test]
fn rejects_duplicate_pool() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_err(GachaError::PoolAlreadyExists);
}
