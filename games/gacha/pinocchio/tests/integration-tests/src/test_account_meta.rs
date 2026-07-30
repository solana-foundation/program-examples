//! IDL-driven account-meta tests: every account an instruction's IDL declares
//! writable must be rejected by the program when demoted to read-only. The fee
//! payer (index 0) is skipped everywhere: the runtime forces it writable.

use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;

use crate::{
    tests::{asserts::TransactionResultExt, constants::PROGRAM_ID, idl, utils::*},
    GachaError,
};

fn demote(metas: &mut [AccountMeta], index: usize) {
    let demoted = &metas[index];
    metas[index] = AccountMeta::new_readonly(demoted.pubkey, demoted.is_signer);
}

fn writable_indices(instruction: &str) -> Vec<usize> {
    let indices: Vec<usize> = idl::instruction_accounts(instruction)
        .into_iter()
        .filter(|a| a.is_writable && a.index != 0)
        .map(|a| a.index)
        .collect();
    assert!(!indices.is_empty(), "IDL declares demotable writable accounts for {instruction}");
    indices
}

#[test]
fn init_pool_writable_accounts_are_enforced() {
    for index in writable_indices("initPool") {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);

        let mut metas = init_pool_metas(&admin.pubkey());
        demote(&mut metas, index);
        let data = init_pool_data(&operator.pubkey(), ENTRY_FEE, SETTLE_DEADLINE, &[100]);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data };
        build_and_send(&mut svm, &[&admin], &admin.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn buy_pull_writable_accounts_are_enforced() {
    for index in writable_indices("buyPull") {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        let buyer = funded_keypair(&mut svm);
        init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

        let mut metas = buy_pull_metas(&admin.pubkey(), &buyer.pubkey(), 0);
        demote(&mut metas, index);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: buy_pull_data(&random_seed()) };
        build_and_send(&mut svm, &[&buyer], &buyer.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

/// Only the accounts the program itself writes (pool, pull) are demoted here;
/// the Light tree accounts are declared writable for the cc-vrf CPI, which
/// enforces them downstream.
#[test]
fn settle_pull_writable_accounts_are_enforced() {
    let indices: Vec<usize> = writable_indices("settlePull").into_iter().filter(|index| *index < 3).collect();
    assert!(!indices.is_empty(), "IDL declares demotable writable accounts for settlePull");

    for index in indices {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        let buyer = funded_keypair(&mut svm);
        init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
        let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
        result.assert_ok();

        let mut metas = settle_pull_metas(&admin.pubkey(), &operator.pubkey(), &pull);
        demote(&mut metas, index);
        let data = settle_pull_data(&beta_from(0), &[0u8; 80]);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data };
        build_and_send(&mut svm, &[&operator], &operator.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn refund_pull_writable_accounts_are_enforced() {
    for index in writable_indices("refundPull") {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        let buyer = funded_keypair(&mut svm);
        init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
        let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
        result.assert_ok();

        let mut metas = refund_pull_metas(&admin.pubkey(), &buyer.pubkey(), &pull);
        demote(&mut metas, index);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: vec![3u8] };
        build_and_send(&mut svm, &[&buyer], &buyer.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn withdraw_fees_writable_accounts_are_enforced() {
    for index in writable_indices("withdrawFees") {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

        let mut metas = withdraw_fees_metas(&admin.pubkey(), &admin.pubkey());
        demote(&mut metas, index);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: withdraw_fees_data(1) };
        build_and_send(&mut svm, &[&admin], &admin.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn claim_prize_writable_accounts_are_enforced() {
    for index in writable_indices("claimPrize") {
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        let buyer = funded_keypair(&mut svm);
        let payer = funded_keypair(&mut svm);
        init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
        let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
        result.assert_ok();

        let mut metas = claim_prize_metas(&admin.pubkey(), &payer.pubkey(), &pull, &buyer.pubkey());
        demote(&mut metas, index);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: vec![5u8] };
        build_and_send(&mut svm, &[&payer], &payer.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn admin_must_sign_init_pool() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let fee_payer = funded_keypair(&mut svm);

    let mut metas = init_pool_metas(&admin.pubkey());
    metas[0] = AccountMeta::new(admin.pubkey(), false); // admin present but not a signer
    let data = init_pool_data(&operator.pubkey(), ENTRY_FEE, SETTLE_DEADLINE, &[100]);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data };

    build_and_send(&mut svm, &[&fee_payer], &fee_payer.pubkey(), &ix).assert_err(GachaError::NotSigner);
}
