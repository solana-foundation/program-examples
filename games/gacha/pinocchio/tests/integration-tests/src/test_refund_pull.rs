use solana_signer::Signer;

use crate::{
    tests::{asserts::TransactionResultExt, utils::*},
    GachaError, Pull,
};

#[test]
fn refund_too_early() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    refund_pull(&mut svm, &admin.pubkey(), &buyer, &pull).assert_err(GachaError::RefundTooEarly);
}

#[test]
fn refund_after_deadline_returns_fee_and_rent() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let requested_slot = read_pull(&svm, &pull).requested_slot;
    svm.warp_to_slot(requested_slot + SETTLE_DEADLINE + 2);

    let buyer_before = svm.get_balance(&buyer.pubkey()).unwrap();
    let vault_before = vault_balance(&svm, &admin.pubkey());

    refund_pull(&mut svm, &admin.pubkey(), &buyer, &pull).assert_ok();

    let pull_rent = svm.minimum_balance_for_rent_exemption(Pull::LEN);
    let buyer_after = svm.get_balance(&buyer.pubkey()).unwrap();
    assert_eq!(buyer_after - buyer_before, ENTRY_FEE + pull_rent - TX_FEE);
    assert_eq!(vault_before - vault_balance(&svm, &admin.pubkey()), ENTRY_FEE);

    let closed = svm.get_account(&pull);
    assert!(closed.is_none_or(|a| a.lamports == 0), "pull account should be closed");

    let pool = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool.pending_pulls, 0);
    assert_eq!(pool.pulls_count, 1);
}

#[test]
fn non_buyer_cannot_refund() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let impostor = funded_keypair(&mut svm);
    refund_pull(&mut svm, &admin.pubkey(), &impostor, &pull).assert_err(GachaError::BuyerMismatch);
}

#[test]
fn settled_pull_cannot_refund() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();
    set_settled_pull(&mut svm, &admin.pubkey(), &buyer.pubkey(), 0, 0);

    refund_pull(&mut svm, &admin.pubkey(), &buyer, &pull).assert_err(GachaError::PullNotPending);
}
