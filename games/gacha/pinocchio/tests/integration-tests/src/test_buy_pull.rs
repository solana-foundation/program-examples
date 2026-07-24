use solana_signer::Signer;

use crate::{
    state::PullStatus,
    tests::{asserts::TransactionResultExt, utils::*},
    TIER_UNSET,
};

#[test]
fn opens_a_pending_pull_and_escrows_fee() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 30], &[100, 100]).assert_ok();

    let vault_before = vault_balance(&svm, &admin.pubkey());
    let (result, pull) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let view = read_pull(&svm, &pull);
    assert_eq!(view.status, PullStatus::Pending as u8);
    assert_eq!(view.tier_selected, TIER_UNSET);
    assert_eq!(view.index, 0);

    assert_eq!(read_pool(&svm, &admin.pubkey()).pulls_count, 1);
    // The vault gains the entry fee minus the pull account rent.
    assert!(vault_balance(&svm, &admin.pubkey()) > vault_before);
}

#[test]
fn increments_pull_index() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 30], &[100, 100]).assert_ok();

    let (r0, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r0.assert_ok();
    let (r1, pull1) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r1.assert_ok();

    assert_eq!(read_pull(&svm, &pull1).index, 1);
    assert_eq!(read_pool(&svm, &admin.pubkey()).pulls_count, 2);
}
