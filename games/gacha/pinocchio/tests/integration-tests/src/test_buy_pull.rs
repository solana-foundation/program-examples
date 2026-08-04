use solana_signer::Signer;

use crate::{
    client,
    state::PullStatus,
    tests::{asserts::TransactionResultExt, utils::*},
    Pull, TIER_UNSET,
};

#[test]
fn opens_a_pending_pull_and_escrows_fee() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 30]).assert_ok();

    let (result, pull, client_seed) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let vault_rent_floor = svm.minimum_balance_for_rent_exemption(0);
    assert_eq!(vault_balance(&svm, &admin.pubkey()), vault_rent_floor + ENTRY_FEE);

    let view = read_pull(&svm, &pull);
    assert_eq!(view.status, PullStatus::Pending as u8);
    assert_eq!(view.tier_selected, TIER_UNSET);
    assert_eq!(view.pool, client::Pool::find_pda(&admin.pubkey()).0.to_bytes());
    assert_eq!(view.buyer, buyer.pubkey().to_bytes());
    assert_eq!(view.index, 0);
    assert_eq!(view.client_seed, client_seed);
    assert_eq!(view.alpha, solana_sha256_hasher::hashv(&[pull.as_ref(), &client_seed]).to_bytes());
    assert_eq!(view.beta, [0u8; 64]);
    assert!(view.requested_slot > 0);
    assert_eq!(view.settled_slot, 0);

    let pool = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool.pulls_count, 1);
    assert_eq!(pool.pending_pulls, 1);
}

#[test]
fn increments_pull_index() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 30]).assert_ok();

    let (r0, _, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r0.assert_ok();
    let (r1, pull1, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    r1.assert_ok();

    assert_eq!(read_pull(&svm, &pull1).index, 1);
    let pool = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool.pulls_count, 2);
    assert_eq!(pool.pending_pulls, 2);
}

#[test]
fn buyer_pays_rent_plus_fee() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let buyer_before = svm.get_balance(&buyer.pubkey()).unwrap();
    let (result, _, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();
    let buyer_after = svm.get_balance(&buyer.pubkey()).unwrap();

    let pull_rent = svm.minimum_balance_for_rent_exemption(Pull::LEN);
    assert_eq!(buyer_before - buyer_after, ENTRY_FEE + pull_rent + TX_FEE);
}
