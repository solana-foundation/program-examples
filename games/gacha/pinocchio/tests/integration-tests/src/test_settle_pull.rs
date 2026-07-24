use solana_signer::Signer;

use crate::{
    select_tier,
    state::PullStatus,
    tests::{asserts::TransactionResultExt, utils::*},
    GachaError,
};

#[test]
fn settles_pull_and_records_tier() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    let weights = [70u32, 25, 5];
    let supplies = [10u32, 10, 10];
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &weights, &supplies).assert_ok();

    let (result, pull) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let before = read_pool(&svm, &admin.pubkey());
    let beta = beta_from(80); // total 100, target 80 -> skip tier0 (70), land in tier1
    let expected = select_tier(&beta, &before.weights, &before.remaining, before.tier_count).unwrap();
    assert_eq!(expected, 1);

    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull, &beta, &[7u8; 80]).assert_ok();

    let view = read_pull(&svm, &pull);
    assert_eq!(view.status, PullStatus::Settled as u8);
    assert_eq!(view.tier_selected, expected);
    assert_eq!(view.beta, beta);

    let after = read_pool(&svm, &admin.pubkey());
    assert_eq!(after.remaining[expected as usize], before.remaining[expected as usize] - 1);
}

#[test]
fn only_operator_can_settle() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100], &[10]).assert_ok();

    let (result, pull) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let impostor = funded_keypair(&mut svm);
    settle_pull(&mut svm, &admin.pubkey(), &impostor, &pull, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::NotOperator);
}

#[test]
fn cannot_settle_twice() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100], &[10]).assert_ok();

    let (result, pull) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull, &beta_from(0), &[0u8; 80]).assert_ok();
    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::PullNotPending);
}

#[test]
fn exhausted_pool_rejects_settle() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    // Single tier with one unit of supply.
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100], &[1]).assert_ok();

    let (r0, pull0) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r0.assert_ok();
    let (r1, pull1) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r1.assert_ok();

    // First settle drains the only tier.
    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull0, &beta_from(0), &[0u8; 80]).assert_ok();
    // Second settle finds no remaining supply.
    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull1, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::PoolExhausted);
}
