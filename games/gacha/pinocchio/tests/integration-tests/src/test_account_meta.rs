use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;

use crate::{
    tests::{
        asserts::TransactionResultExt,
        constants::PROGRAM_ID,
        idl,
        utils::{build_and_send, funded_keypair, init_pool_data, init_pool_metas, setup, ENTRY_FEE},
    },
    GachaError,
};

fn init_pool_ix_data(operator: &solana_pubkey::Pubkey) -> Vec<u8> {
    init_pool_data(operator, ENTRY_FEE, &[100], &[10])
}

#[test]
fn idl_writable_accounts_are_enforced() {
    let writable: Vec<idl::IdlAccount> =
        idl::instruction_accounts("initPool").into_iter().filter(|a| a.is_writable).collect();
    assert!(!writable.is_empty(), "IDL declares writable accounts");

    for account in writable {
        if account.index == 0 {
            continue; // admin is the fee payer: runtime forces it writable, can't demote
        }
        let (mut svm, admin) = setup();
        let operator = funded_keypair(&mut svm);
        let mut metas = init_pool_metas(&admin.pubkey());
        let demoted = &metas[account.index];
        metas[account.index] = AccountMeta::new_readonly(demoted.pubkey, demoted.is_signer);
        let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: init_pool_ix_data(&operator.pubkey()) };
        build_and_send(&mut svm, &[&admin], &admin.pubkey(), &ix).assert_err(GachaError::AccountNotWritable);
    }
}

#[test]
fn admin_must_sign_init_pool() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let fee_payer = funded_keypair(&mut svm);

    let mut metas = init_pool_metas(&admin.pubkey());
    metas[0] = AccountMeta::new(admin.pubkey(), false); // admin present but not a signer
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: init_pool_ix_data(&operator.pubkey()) };

    build_and_send(&mut svm, &[&fee_payer], &fee_payer.pubkey(), &ix).assert_err(GachaError::NotSigner);
}
