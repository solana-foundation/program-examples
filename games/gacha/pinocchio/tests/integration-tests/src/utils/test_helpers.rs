use core::mem::size_of;

use litesvm::{types::TransactionResult, LiteSVM};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::{
    ccvrf::{
        LightCommitContext, ACCOUNT_COMPRESSION_AUTHORITY, ACCOUNT_COMPRESSION_PROGRAM_ID, ADDRESS_TREE_V2,
        CC_VRF_CPI_AUTHORITY, CC_VRF_PROGRAM_ID, LIGHT_SYSTEM_PROGRAM_ID, REGISTERED_PROGRAM_PDA,
    },
    client,
    event_engine::event_authority_pda,
    tests::{
        constants::{ATA_PROGRAM_ID, PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_2022_ID},
        pda::get_ata,
    },
    utils::cu_tracker::record_cu,
    GachaInstruction, Pool, Pull,
};

/// Default entry fee used by the helpers (0.1 SOL).
pub const ENTRY_FEE: u64 = 100_000_000;
/// Default settle deadline used by the helpers, in slots.
pub const SETTLE_DEADLINE: u64 = 100;
/// Default cc-vrf authority label used by the helpers.
pub const AUTHORITY_LABEL: [u8; 32] = [7u8; 32];

pub fn setup() -> (LiteSVM, Keypair) {
    let mut litesvm = LiteSVM::new();
    litesvm.warp_to_slot(1);

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

/// LiteSVM's default fee for a single-signature transaction.
pub const TX_FEE: u64 = 5_000;

#[allow(clippy::result_large_err)]
pub fn build_and_send(
    litesvm: &mut LiteSVM,
    signers: &[&Keypair],
    payer: &Address,
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

/// Serializes `InitPool` instruction data (weights zero-padded to 8 tiers).
pub fn init_pool_data(operator: &Address, entry_fee: u64, settle_deadline_slots: u64, weights: &[u32]) -> Vec<u8> {
    let mut data = vec![0u8];
    data.extend_from_slice(operator.as_ref());
    data.extend_from_slice(&AUTHORITY_LABEL);
    data.extend_from_slice(&entry_fee.to_le_bytes());
    data.extend_from_slice(&settle_deadline_slots.to_le_bytes());
    data.push(weights.len() as u8);
    let mut w = [0u32; 8];
    w[..weights.len()].copy_from_slice(weights);
    for value in w {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data
}

pub fn init_pool_metas(admin: &Address) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    let (vault, _) = client::Vault::find_pda(admin);
    vec![
        AccountMeta::new(*admin, true),
        AccountMeta::new(pool, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

#[allow(clippy::result_large_err)]
pub fn init_pool(
    litesvm: &mut LiteSVM,
    admin: &Keypair,
    operator: &Address,
    entry_fee: u64,
    weights: &[u32],
) -> TransactionResult {
    init_pool_with_deadline(litesvm, admin, operator, entry_fee, SETTLE_DEADLINE, weights)
}

#[allow(clippy::result_large_err)]
pub fn init_pool_with_deadline(
    litesvm: &mut LiteSVM,
    admin: &Keypair,
    operator: &Address,
    entry_fee: u64,
    settle_deadline_slots: u64,
    weights: &[u32],
) -> TransactionResult {
    let data = init_pool_data(operator, entry_fee, settle_deadline_slots, weights);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: init_pool_metas(&admin.pubkey()), data };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

/// 32 bytes of fresh test entropy for a buyer's client seed.
pub fn random_seed() -> [u8; 32] {
    Keypair::new().pubkey().to_bytes()
}

pub fn buy_pull_metas(admin: &Address, buyer: &Address, index: u64) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    let (vault, _) = client::Vault::find_pda(admin);
    let (pull, _) = client::Pull::find_pda(&pool, buyer, index);
    vec![
        AccountMeta::new(*buyer, true),
        AccountMeta::new(pool, false),
        AccountMeta::new(pull, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

/// Serializes `BuyPull` instruction data.
pub fn buy_pull_data(client_seed: &[u8; 32]) -> Vec<u8> {
    let mut data = vec![1u8];
    data.extend_from_slice(client_seed);
    data
}

#[allow(clippy::result_large_err)]
pub fn buy_pull_with_seed(
    litesvm: &mut LiteSVM,
    admin: &Address,
    buyer: &Keypair,
    client_seed: &[u8; 32],
) -> (TransactionResult, Address) {
    let (pool, _) = client::Pool::find_pda(admin);
    let index = read_pool(litesvm, admin).pulls_count;
    let (pull, _) = client::Pull::find_pda(&pool, &buyer.pubkey(), index);

    let accounts = buy_pull_metas(admin, &buyer.pubkey(), index);
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: buy_pull_data(client_seed) };
    (build_and_send(litesvm, &[buyer], &buyer.pubkey(), &ix), pull)
}

/// Buys a pull with a random client seed, returning the seed for alpha checks.
#[allow(clippy::result_large_err)]
pub fn buy_pull(litesvm: &mut LiteSVM, admin: &Address, buyer: &Keypair) -> (TransactionResult, Address, [u8; 32]) {
    let client_seed = random_seed();
    let (result, pull) = buy_pull_with_seed(litesvm, admin, buyer, &client_seed);
    (result, pull, client_seed)
}

/// Serializes `SettlePull` instruction data with a zeroed [`LightCommitContext`];
/// the settle failures exercised here all occur before the cc-vrf CPI reads it.
pub fn settle_pull_data(beta: &[u8; 64], proof: &[u8; 80]) -> Vec<u8> {
    let mut data = vec![2u8];
    data.extend_from_slice(proof);
    data.extend_from_slice(beta);
    data.extend_from_slice(&[0u8; size_of::<LightCommitContext>()]);
    data
}

/// Account metas for `SettlePull`. The mutable Light tree accounts are dummies:
/// they are only touched by the cc-vrf CPI, which the negative tests never reach.
pub fn settle_pull_metas(admin: &Address, operator: &Address, pull: &Address) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    vec![
        AccountMeta::new(*operator, true),
        AccountMeta::new(pool, false),
        AccountMeta::new(*pull, false),
        AccountMeta::new_readonly(CC_VRF_PROGRAM_ID, false),
        AccountMeta::new_readonly(LIGHT_SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(CC_VRF_CPI_AUTHORITY, false),
        AccountMeta::new_readonly(REGISTERED_PROGRAM_PDA, false),
        AccountMeta::new_readonly(ACCOUNT_COMPRESSION_AUTHORITY, false),
        AccountMeta::new_readonly(ACCOUNT_COMPRESSION_PROGRAM_ID, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new(Address::new_unique(), false),
        AccountMeta::new(Address::new_unique(), false),
        AccountMeta::new(ADDRESS_TREE_V2, false),
        AccountMeta::new(Address::new_unique(), false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

#[allow(clippy::result_large_err)]
pub fn settle_pull(
    litesvm: &mut LiteSVM,
    admin: &Address,
    operator: &Keypair,
    pull: &Address,
    beta: &[u8; 64],
    proof: &[u8; 80],
) -> TransactionResult {
    let accounts = settle_pull_metas(admin, &operator.pubkey(), pull);
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: settle_pull_data(beta, proof) };
    build_and_send(litesvm, &[operator], &operator.pubkey(), &ix)
}

pub fn refund_pull_metas(admin: &Address, buyer: &Address, pull: &Address) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    let (vault, _) = client::Vault::find_pda(admin);
    vec![
        AccountMeta::new(*buyer, true),
        AccountMeta::new(pool, false),
        AccountMeta::new(*pull, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

#[allow(clippy::result_large_err)]
pub fn refund_pull(litesvm: &mut LiteSVM, admin: &Address, buyer: &Keypair, pull: &Address) -> TransactionResult {
    let accounts = refund_pull_metas(admin, &buyer.pubkey(), pull);
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![3u8] };
    build_and_send(litesvm, &[buyer], &buyer.pubkey(), &ix)
}

pub fn withdraw_fees_metas(admin: &Address, signer: &Address) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    let (vault, _) = client::Vault::find_pda(admin);
    vec![
        AccountMeta::new(*signer, true),
        AccountMeta::new_readonly(pool, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

/// Serializes `WithdrawFees` instruction data.
pub fn withdraw_fees_data(amount: u64) -> Vec<u8> {
    let mut data = vec![4u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

#[allow(clippy::result_large_err)]
pub fn withdraw_fees(litesvm: &mut LiteSVM, admin: &Address, signer: &Keypair, amount: u64) -> TransactionResult {
    let accounts = withdraw_fees_metas(admin, &signer.pubkey());
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: withdraw_fees_data(amount) };
    build_and_send(litesvm, &[signer], &signer.pubkey(), &ix)
}

pub fn claim_prize_metas(admin: &Address, payer: &Address, pull: &Address, buyer: &Address) -> Vec<AccountMeta> {
    let (pool, _) = client::Pool::find_pda(admin);
    let (mint, _) = client::PrizeMint::find_pda(pull);
    let buyer_ata = get_ata(buyer, &mint);
    vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new_readonly(pool, false),
        AccountMeta::new(*pull, false),
        AccountMeta::new_readonly(*buyer, false),
        AccountMeta::new(mint, false),
        AccountMeta::new(buyer_ata, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(TOKEN_2022_ID, false),
        AccountMeta::new_readonly(ATA_PROGRAM_ID, false),
        AccountMeta::new_readonly(event_authority_pda::ID, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ]
}

#[allow(clippy::result_large_err)]
pub fn claim_prize(
    litesvm: &mut LiteSVM,
    admin: &Address,
    payer: &Keypair,
    pull: &Address,
    buyer: &Address,
) -> TransactionResult {
    let accounts = claim_prize_metas(admin, &payer.pubkey(), pull, buyer);
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![5u8] };
    build_and_send(litesvm, &[payer], &payer.pubkey(), &ix)
}

/// Snapshot of the pool fields tests assert on (copied out of the packed struct).
pub struct PoolView {
    pub tier_count: u8,
    pub admin: [u8; 32],
    pub operator: [u8; 32],
    pub authority_label: [u8; 32],
    pub entry_fee: u64,
    pub pulls_count: u64,
    pub pending_pulls: u64,
    pub settle_deadline_slots: u64,
    pub weights: [u32; 8],
}

pub fn read_pool(litesvm: &LiteSVM, admin: &Address) -> PoolView {
    let (pool, _) = client::Pool::find_pda(admin);
    let account = litesvm.get_account(&pool).expect("pool exists");
    let p = Pool::load(&account.data).expect("valid pool");
    let admin_key = p.admin;
    let operator = p.operator;
    PoolView {
        tier_count: p.tier_count,
        admin: admin_key.to_bytes(),
        operator: operator.to_bytes(),
        authority_label: p.authority_label,
        entry_fee: p.entry_fee,
        pulls_count: p.pulls_count,
        pending_pulls: p.pending_pulls,
        settle_deadline_slots: p.settle_deadline_slots,
        weights: p.weights,
    }
}

/// Snapshot of the pull fields tests assert on.
pub struct PullView {
    pub status: u8,
    pub tier_selected: u8,
    pub pool: [u8; 32],
    pub buyer: [u8; 32],
    pub index: u64,
    pub client_seed: [u8; 32],
    pub alpha: [u8; 32],
    pub beta: [u8; 64],
    pub requested_slot: u64,
    pub settled_slot: u64,
}

pub fn read_pull(litesvm: &LiteSVM, pull: &Address) -> PullView {
    let account = litesvm.get_account(pull).expect("pull exists");
    let p = Pull::load(&account.data).expect("valid pull");
    let pool = p.pool;
    let buyer = p.buyer;
    PullView {
        status: p.status,
        tier_selected: p.tier_selected,
        pool: pool.to_bytes(),
        buyer: buyer.to_bytes(),
        index: p.index,
        client_seed: p.client_seed,
        alpha: p.alpha,
        beta: p.beta,
        requested_slot: p.requested_slot,
        settled_slot: p.settled_slot,
    }
}

pub fn vault_balance(litesvm: &LiteSVM, admin: &Address) -> u64 {
    let (vault, _) = client::Vault::find_pda(admin);
    litesvm.get_account(&vault).map(|a| a.lamports).unwrap_or(0)
}

/// A `beta` whose first 16 bytes encode `value` as a little-endian u128.
pub fn beta_from(value: u128) -> [u8; 64] {
    let mut beta = [0u8; 64];
    beta[..16].copy_from_slice(&value.to_le_bytes());
    beta
}

/// Fabricates a settled pull directly in the bank, bypassing the operator's
/// cc-vrf settle path (which needs the full Light stack). If the pull already
/// exists (from a real buy) it is flipped to settled and the pool's
/// `pending_pulls` is decremented; otherwise a settled pull is written from
/// scratch and the pool's `pulls_count` is advanced past `index`.
pub fn set_settled_pull(litesvm: &mut LiteSVM, admin: &Address, buyer: &Address, index: u64, tier: u8) -> Address {
    let (pool_pda, _) = client::Pool::find_pda(admin);
    let (pull_pda, pull_bump) = client::Pull::find_pda(&pool_pda, buyer, index);
    let slot = litesvm.get_sysvar::<Clock>().slot;

    let existing = litesvm.get_account(&pull_pda).filter(|a| !a.data.is_empty());
    let was_pending = existing.is_some();
    let (lamports, mut data) = match existing {
        Some(account) => (account.lamports, account.data),
        None => {
            let mut bytes = vec![0u8; Pull::LEN];
            Pull::init(
                &mut bytes,
                pull_bump,
                &Address::new_from_array(pool_pda.to_bytes()),
                &Address::new_from_array(buyer.to_bytes()),
                index,
                &random_seed(),
                &[8u8; 32],
                slot,
            )
            .expect("valid pull bytes");
            (litesvm.minimum_balance_for_rent_exemption(Pull::LEN), bytes)
        }
    };
    Pull::load_mut(&mut data).expect("valid pull").settle(&[9u8; 64], tier, slot);
    litesvm
        .set_account(pull_pda, Account { lamports, data, owner: PROGRAM_ID, executable: false, rent_epoch: 0 })
        .expect("set pull account");

    let pool_account = litesvm.get_account(&pool_pda).expect("pool exists");
    let mut pool_data = pool_account.data.clone();
    {
        let pool = Pool::load_mut(&mut pool_data).expect("valid pool");
        if was_pending {
            pool.pending_pulls -= 1;
        } else if pool.pulls_count <= index {
            pool.pulls_count = index + 1;
        }
    }
    litesvm
        .set_account(
            pool_pda,
            Account {
                lamports: pool_account.lamports,
                data: pool_data,
                owner: PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("set pool account");

    pull_pda
}
