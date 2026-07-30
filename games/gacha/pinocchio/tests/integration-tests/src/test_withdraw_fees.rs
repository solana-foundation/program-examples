use solana_signer::Signer;

use crate::{
    tests::{asserts::TransactionResultExt, utils::*},
    GachaError,
};

#[test]
fn non_admin_rejected() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let impostor = funded_keypair(&mut svm);
    withdraw_fees(&mut svm, &admin.pubkey(), &impostor, 1).assert_err(GachaError::Unauthorized);
}

#[test]
fn zero_amount_rejected() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    withdraw_fees(&mut svm, &admin.pubkey(), &admin, 0).assert_err(GachaError::InsufficientVaultFunds);
}

#[test]
fn withdraw_respects_pending_liability() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, _, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let vault_rent_floor = svm.minimum_balance_for_rent_exemption(0);
    let available = vault_balance(&svm, &admin.pubkey()) - vault_rent_floor;
    assert_eq!(available, ENTRY_FEE);

    withdraw_fees(&mut svm, &admin.pubkey(), &admin, available).assert_err(GachaError::InsufficientVaultFunds);

    set_settled_pull(&mut svm, &admin.pubkey(), &buyer.pubkey(), 0, 0);
    assert_eq!(read_pool(&svm, &admin.pubkey()).pending_pulls, 0);

    let admin_before = svm.get_balance(&admin.pubkey()).unwrap();
    let vault_before = vault_balance(&svm, &admin.pubkey());
    withdraw_fees(&mut svm, &admin.pubkey(), &admin, available).assert_ok();

    let admin_after = svm.get_balance(&admin.pubkey()).unwrap();
    assert_eq!(admin_after - admin_before, ENTRY_FEE - TX_FEE);
    assert_eq!(vault_before - vault_balance(&svm, &admin.pubkey()), ENTRY_FEE);
    assert_eq!(vault_balance(&svm, &admin.pubkey()), vault_rent_floor);
}
