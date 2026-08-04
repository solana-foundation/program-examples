//! Negative settle tests. Every failure here occurs before the cc-vrf CPI, so
//! the Light passthrough accounts can be dummies; the happy path (a real commit
//! against the cc-vrf registry) lives in the Light-stack suite.

use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;

use crate::{
    tests::{asserts::TransactionResultExt, constants::PROGRAM_ID, utils::*},
    GachaError,
};

#[test]
fn only_operator_can_settle() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let impostor = funded_keypair(&mut svm);
    settle_pull(&mut svm, &admin.pubkey(), &impostor, &pull, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::NotOperator);
}

#[test]
fn rejects_wrong_cc_vrf_program() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let mut metas = settle_pull_metas(&admin.pubkey(), &operator.pubkey(), &pull);
    metas[3] = AccountMeta::new_readonly(Address::new_unique(), false);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: settle_pull_data(&beta_from(0), &[0u8; 80]) };
    build_and_send(&mut svm, &[&operator], &operator.pubkey(), &ix).assert_err(GachaError::NotCcVrfProgram);
}

#[test]
fn cannot_settle_settled_pull() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();
    set_settled_pull(&mut svm, &admin.pubkey(), &buyer.pubkey(), 0, 0);

    settle_pull(&mut svm, &admin.pubkey(), &operator, &pull, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::PullNotPending);
}

#[test]
fn rejects_pool_mismatch() {
    let (mut svm, admin_a) = setup();
    let admin_b = funded_keypair(&mut svm);
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin_a, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
    init_pool(&mut svm, &admin_b, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin_a.pubkey(), &buyer);
    result.assert_ok();

    settle_pull(&mut svm, &admin_b.pubkey(), &operator, &pull, &beta_from(0), &[0u8; 80])
        .assert_err(GachaError::PoolMismatch);
}

#[test]
fn operator_must_be_writable() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    let fee_payer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let mut metas = settle_pull_metas(&admin.pubkey(), &operator.pubkey(), &pull);
    metas[0] = AccountMeta::new_readonly(operator.pubkey(), true);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: settle_pull_data(&beta_from(0), &[0u8; 80]) };
    build_and_send(&mut svm, &[&fee_payer, &operator], &fee_payer.pubkey(), &ix)
        .assert_err(GachaError::AccountNotWritable);
}
