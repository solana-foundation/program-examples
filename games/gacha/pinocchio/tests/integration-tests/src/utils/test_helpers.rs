use litesvm::{types::TransactionResult, LiteSVM};
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::{
    tests::{
        constants::{EVENT_AUTHORITY, PROGRAM_ID, SYSTEM_PROGRAM_ID},
        pda::{get_pool_pda, get_pull_pda, get_vault_pda},
    },
    utils::cu_tracker::record_cu,
    GachaInstruction, Pool, Pull,
};

/// Default entry fee used by the helpers (0.1 SOL).
pub const ENTRY_FEE: u64 = 100_000_000;

pub fn setup() -> (LiteSVM, Keypair) {
    let mut litesvm = LiteSVM::new();

    let so_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/gacha_program.so");
    litesvm.add_program_from_file(PROGRAM_ID.to_bytes(), so_path).unwrap();

    let admin = Keypair::new();
    litesvm.airdrop(&admin.pubkey(), LAMPORTS_PER_SOL * 100).unwrap();

    (litesvm, admin)
}

pub fn funded_keypair(litesvm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    litesvm.airdrop(&kp.pubkey(), LAMPORTS_PER_SOL * 100).unwrap();
    kp
}

#[allow(clippy::result_large_err)]
pub fn build_and_send(
    litesvm: &mut LiteSVM,
    signers: &[&Keypair],
    payer: &Pubkey,
    ix: &Instruction,
) -> TransactionResult {
    let tx = Transaction::new(signers, Message::new(std::slice::from_ref(ix), Some(payer)), litesvm.latest_blockhash());
    let result = litesvm.send_transaction(tx);
    if let Ok(meta) = &result {
        if let Ok(parsed) = GachaInstruction::from_bytes(&ix.data) {
            record_cu(&parsed.to_string(), meta.compute_units_consumed);
        }
    }
    litesvm.expire_blockhash();
    result
}

/// Serializes `InitPool` instruction data (weights/supplies zero-padded to 8 tiers).
pub fn init_pool_data(operator: &Pubkey, entry_fee: u64, weights: &[u32], supplies: &[u32]) -> Vec<u8> {
    assert_eq!(weights.len(), supplies.len());
    let mut data = vec![0u8];
    data.extend_from_slice(operator.as_ref());
    data.extend_from_slice(&entry_fee.to_le_bytes());
    data.push(weights.len() as u8);
    let mut w = [0u32; 8];
    w[..weights.len()].copy_from_slice(weights);
    let mut s = [0u32; 8];
    s[..supplies.len()].copy_from_slice(supplies);
    for value in w {
        data.extend_from_slice(&value.to_le_bytes());
    }
    for value in s {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data
}

pub fn init_pool_metas(admin: &Pubkey) -> Vec<AccountMeta> {
    let (pool, _) = get_pool_pda(admin);
    let (vault, _) = get_vault_pda(admin);
    vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new(pool, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

#[allow(clippy::result_large_err)]
pub fn init_pool(
    litesvm: &mut LiteSVM,
    admin: &Keypair,
    operator: &Pubkey,
    entry_fee: u64,
    weights: &[u32],
    supplies: &[u32],
) -> TransactionResult {
    let data = init_pool_data(operator, entry_fee, weights, supplies);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: init_pool_metas(&admin.pubkey()), data };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn buy_pull(litesvm: &mut LiteSVM, admin: &Pubkey, buyer: &Keypair) -> (TransactionResult, Pubkey) {
    let (pool, _) = get_pool_pda(admin);
    let (vault, _) = get_vault_pda(admin);
    let index = read_pool(litesvm, admin).pulls_count;
    let (pull, _) = get_pull_pda(&pool, &buyer.pubkey(), index);

    let accounts = vec![
        AccountMeta::new(buyer.pubkey(), true),
        AccountMeta::new(pool, false),
        AccountMeta::new(pull, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![1u8] };
    (build_and_send(litesvm, &[buyer], &buyer.pubkey(), &ix), pull)
}

#[allow(clippy::result_large_err)]
pub fn settle_pull(
    litesvm: &mut LiteSVM,
    admin: &Pubkey,
    operator: &Keypair,
    pull: &Pubkey,
    beta: &[u8; 64],
    proof: &[u8; 80],
) -> TransactionResult {
    let (pool, _) = get_pool_pda(admin);
    let mut data = vec![2u8];
    data.extend_from_slice(beta);
    data.extend_from_slice(proof);

    let accounts = vec![
        AccountMeta::new_readonly(operator.pubkey(), true),
        AccountMeta::new(pool, false),
        AccountMeta::new(*pull, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data };
    build_and_send(litesvm, &[operator], &operator.pubkey(), &ix)
}

/// Snapshot of the pool fields tests assert on (copied out of the packed struct).
pub struct PoolView {
    pub tier_count: u8,
    pub entry_fee: u64,
    pub pulls_count: u64,
    pub operator: [u8; 32],
    pub weights: [u32; 8],
    pub supplies: [u32; 8],
    pub remaining: [u32; 8],
}

pub fn read_pool(litesvm: &LiteSVM, admin: &Pubkey) -> PoolView {
    let (pool, _) = get_pool_pda(admin);
    let account = litesvm.get_account(&pool).expect("pool exists");
    let p = Pool::load(&account.data).expect("valid pool");
    let operator = p.operator;
    let mut op = [0u8; 32];
    op.copy_from_slice(operator.as_ref());
    PoolView {
        tier_count: p.tier_count,
        entry_fee: p.entry_fee,
        pulls_count: p.pulls_count,
        operator: op,
        weights: p.weights,
        supplies: p.supplies,
        remaining: p.remaining,
    }
}

/// Snapshot of the pull fields tests assert on.
pub struct PullView {
    pub status: u8,
    pub tier_selected: u8,
    pub index: u64,
    pub beta: [u8; 64],
}

pub fn read_pull(litesvm: &LiteSVM, pull: &Pubkey) -> PullView {
    let account = litesvm.get_account(pull).expect("pull exists");
    let p = Pull::load(&account.data).expect("valid pull");
    PullView { status: p.status, tier_selected: p.tier_selected, index: p.index, beta: p.beta }
}

pub fn vault_balance(litesvm: &LiteSVM, admin: &Pubkey) -> u64 {
    let (vault, _) = get_vault_pda(admin);
    litesvm.get_account(&vault).map(|a| a.lamports).unwrap_or(0)
}

/// A `beta` whose first 16 bytes encode `value` as a little-endian u128.
pub fn beta_from(value: u128) -> [u8; 64] {
    let mut beta = [0u8; 64];
    beta[..16].copy_from_slice(&value.to_le_bytes());
    beta
}
