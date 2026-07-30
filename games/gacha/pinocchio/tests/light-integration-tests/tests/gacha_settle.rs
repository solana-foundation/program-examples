//! The real `settle_pull` → cc-vrf → Light Protocol CPI chain, with genuine
//! validity proofs — plus the claim and refund paths that depend on a real
//! settle. Complements the LiteSVM suite in `../integration-tests`, which
//! covers everything that fails before the cc-vrf CPI.
//!
//! The ECVRF proof and beta are synthetic bytes: the program never verifies
//! them on-chain (detection, not prevention — see the program CLAUDE.md), so
//! these tests exercise exactly what the chain enforces: the operator's frozen
//! registry record, one commit per pull, and tier selection from `beta`.

mod common;

use common::*;
use gacha::state::{common::PullStatus, pool::Pool, pull::Pull};
use light_program_test::{program_test::LightProgramTest, AddressWithTree, Indexer, ProgramTestConfig, Rpc};
use sha2::{Digest, Sha256};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    native_token::LAMPORTS_PER_SOL,
    pubkey,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use solana_system_interface::program as system_program;
use spl_token_2022::{
    extension::{metadata_pointer::MetadataPointer, BaseStateWithExtensions, StateWithExtensions},
    state::{Account as TokenAccount, Mint},
};
use spl_token_metadata_interface::state::TokenMetadata;

const GACHA_ID: Pubkey = pubkey!("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS");
const LIGHT_SYSTEM_PROGRAM_ID: Pubkey = pubkey!("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");
const REGISTERED_PROGRAM_PDA: Pubkey = pubkey!("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh");
const ACCOUNT_COMPRESSION_AUTHORITY: Pubkey = pubkey!("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA");
const ACCOUNT_COMPRESSION_PROGRAM_ID: Pubkey = pubkey!("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");
const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const AUTHORITY_LABEL: [u8; 32] = [7u8; 32];
const ENTRY_FEE: u64 = 100_000_000;
const SETTLE_DEADLINE: u64 = 100;
const WEIGHTS: [u32; 3] = [70, 25, 5];

/// Borsh-serialized size of `LightCommitContext` in `SettlePullData`.
const LIGHT_CONTEXT_LEN: usize = 177;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

struct Env {
    rpc: LightProgramTest,
    operator: Keypair,
    buyer: Keypair,
    pool: Pubkey,
    vault: Pubkey,
    authority_address: [u8; 32],
    authority_created_slot: u64,
}

/// Boots LightProgramTest with cc-vrf + the gacha program, registers the
/// operator in the cc-vrf registry (frozen or not), and initializes a pool
/// whose operator/label pin that registration.
async fn setup(freeze: bool) -> Env {
    let fixtures = format!("{}/../fixtures", env!("CARGO_MANIFEST_DIR"));
    std::env::set_var("SBF_OUT_DIR", &fixtures);

    let config = ProgramTestConfig::new(true, Some(vec![("cc_vrf", CC_VRF_ID), ("gacha_program", GACHA_ID)]));
    let mut rpc = LightProgramTest::new(config).await.expect("boot failed");
    assert_eq!(rpc.get_address_tree_v2().tree, CANONICAL_ADDRESS_TREE_V2);

    // Pinocchio 0.11 reads the rent sysvar with modern (agave v3) semantics:
    // the first u64 of the sysvar data is the effective lamports-per-byte rate
    // (6960). This crate's older runtime (litesvm 0.7 / agave 2.x) still
    // serves the legacy layout, whose first u64 is 3480 with a separate 2.0
    // exemption threshold — the program would fund PDAs at half the runtime's
    // minimum. Rewriting the sysvar as 6960 x 1.0 makes both readers compute
    // the same (canonical) minimums.
    rpc.context.set_sysvar(&solana_sdk::rent::Rent {
        lamports_per_byte_year: 6960,
        exemption_threshold: 1.0,
        burn_percent: 50,
    });

    let admin = Keypair::new();
    let operator = Keypair::new();
    let buyer = Keypair::new();
    for kp in [&admin, &operator, &buyer] {
        rpc.airdrop_lamports(&kp.pubkey(), 100 * LAMPORTS_PER_SOL).await.expect("airdrop");
    }

    let (authority_address, authority_state) = register_authority(&mut rpc, &operator, AUTHORITY_LABEL, freeze).await;

    let (pool, vault) = init_pool(&mut rpc, &admin, &operator.pubkey()).await;

    Env { rpc, operator, buyer, pool, vault, authority_address, authority_created_slot: authority_state.created_slot }
}

fn pool_pda(admin: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"pool", admin.as_ref()], &GACHA_ID).0
}

fn vault_pda(admin: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", admin.as_ref()], &GACHA_ID).0
}

fn pull_pda(pool: &Pubkey, buyer: &Pubkey, index: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"pull", pool.as_ref(), buyer.as_ref(), &index.to_le_bytes()], &GACHA_ID).0
}

fn mint_pda(pull: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"mint", pull.as_ref()], &GACHA_ID).0
}

fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), TOKEN_2022_ID.as_ref(), mint.as_ref()], &ATA_PROGRAM_ID).0
}

fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"event_authority"], &GACHA_ID).0
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// 32 bytes of fresh test entropy for a buyer's client seed.
fn random_seed() -> [u8; 32] {
    Keypair::new().pubkey().to_bytes()
}

/// A `beta` whose first 16 bytes encode `value` as a little-endian u128, so the
/// selected tier is `value % total_weight` walked through the weight table.
fn beta_from(value: u128) -> [u8; 64] {
    let mut beta = [0u8; 64];
    beta[..16].copy_from_slice(&value.to_le_bytes());
    beta
}

fn expected_tier(beta: &[u8; 64]) -> u8 {
    let mut weights = [0u32; 8];
    weights[..WEIGHTS.len()].copy_from_slice(&WEIGHTS);
    gacha::select_tier(beta, &weights, WEIGHTS.len() as u8).expect("valid tier config")
}

fn assert_gacha_err(err: &str, code: gacha::GachaError) {
    let needle = format!("Custom({})", code as u32);
    assert!(err.contains(&needle), "expected {needle} in: {err}");
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

async fn init_pool(rpc: &mut LightProgramTest, admin: &Keypair, operator: &Pubkey) -> (Pubkey, Pubkey) {
    let pool = pool_pda(&admin.pubkey());
    let vault = vault_pda(&admin.pubkey());

    let mut data = vec![0u8];
    data.extend_from_slice(operator.as_ref());
    data.extend_from_slice(&AUTHORITY_LABEL);
    data.extend_from_slice(&ENTRY_FEE.to_le_bytes());
    data.extend_from_slice(&SETTLE_DEADLINE.to_le_bytes());
    data.push(WEIGHTS.len() as u8);
    let mut weights = [0u32; 8];
    weights[..WEIGHTS.len()].copy_from_slice(&WEIGHTS);
    for weight in weights {
        data.extend_from_slice(&weight.to_le_bytes());
    }

    let ix = Instruction {
        program_id: GACHA_ID,
        accounts: vec![
            AccountMeta::new(admin.pubkey(), true),
            AccountMeta::new(pool, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(GACHA_ID, false),
        ],
        data,
    };
    rpc.create_and_send_transaction(&[ix], &admin.pubkey(), &[admin]).await.expect("init_pool tx failed");
    (pool, vault)
}

async fn buy_pull(rpc: &mut LightProgramTest, pool: &Pubkey, buyer: &Keypair) -> (Pubkey, [u8; 32]) {
    let view = read_pool(rpc, pool).await;
    let vault = vault_pda(&Pubkey::new_from_array(view.admin));
    let pull = pull_pda(pool, &buyer.pubkey(), view.pulls_count);
    let client_seed = random_seed();

    let mut data = vec![1u8];
    data.extend_from_slice(&client_seed);

    let ix = Instruction {
        program_id: GACHA_ID,
        accounts: vec![
            AccountMeta::new(buyer.pubkey(), true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(pull, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(GACHA_ID, false),
        ],
        data,
    };
    rpc.create_and_send_transaction(&[ix], &buyer.pubkey(), &[buyer]).await.expect("buy_pull tx failed");
    (pull, client_seed)
}

/// Builds a `settle_pull` instruction from raw parts. The tree slice order
/// (authority tree, authority queue, address tree, output queue) must match the
/// packed indices 0/1/2/3 the program hardcodes into the cc-vrf CPI data.
fn settle_ix(
    pool: &Pubkey,
    operator: &Pubkey,
    pull: &Pubkey,
    beta: &[u8; 64],
    proof: &[u8; 80],
    light_context: &[u8; LIGHT_CONTEXT_LEN],
    trees: [Pubkey; 4],
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 80 + 64 + LIGHT_CONTEXT_LEN);
    data.push(2u8);
    data.extend_from_slice(proof);
    data.extend_from_slice(beta);
    data.extend_from_slice(light_context);

    Instruction {
        program_id: GACHA_ID,
        accounts: vec![
            AccountMeta::new(*operator, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*pull, false),
            AccountMeta::new_readonly(CC_VRF_ID, false),
            AccountMeta::new_readonly(LIGHT_SYSTEM_PROGRAM_ID, false),
            AccountMeta::new_readonly(CC_VRF_CPI_AUTHORITY, false),
            AccountMeta::new_readonly(REGISTERED_PROGRAM_PDA, false),
            AccountMeta::new_readonly(ACCOUNT_COMPRESSION_AUTHORITY, false),
            AccountMeta::new_readonly(ACCOUNT_COMPRESSION_PROGRAM_ID, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new(trees[0], false),
            AccountMeta::new(trees[1], false),
            AccountMeta::new(trees[2], false),
            AccountMeta::new(trees[3], false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(GACHA_ID, false),
        ],
        data,
    }
}

/// Fetches a combined validity proof (authority inclusion + commit address
/// non-inclusion), fills `LightCommitContext`, and sends the settle transaction
/// signed by `operator`. Errors are returned debug-formatted for assertion.
#[allow(clippy::too_many_arguments)]
async fn send_settle(
    rpc: &mut LightProgramTest,
    pool: &Pubkey,
    operator: &Keypair,
    pull: &Pubkey,
    beta: &[u8; 64],
    proof: &[u8; 80],
    authority_address: [u8; 32],
    authority_created_slot: u64,
) -> Result<(), String> {
    let address_tree = rpc.get_address_tree_v2().tree;
    let authority_account = fetch_authority(rpc, authority_address).await;
    let memo_hash = sha256(pull.as_ref());
    let commit_addr = commit_address(rpc, &authority_address, &memo_hash);

    let proof_result = rpc
        .get_validity_proof(
            vec![authority_account.hash],
            vec![AddressWithTree { address: commit_addr, tree: address_tree }],
            None,
        )
        .await
        .map_err(|e| format!("{e:?}"))?
        .value;

    let account_inputs = &proof_result.accounts[0];
    let authority_tree = account_inputs.tree_info.tree;
    let authority_queue = account_inputs.tree_info.queue;
    let output_queue =
        account_inputs.tree_info.next_tree_info.as_ref().map(|next| next.queue).unwrap_or(authority_queue);
    let compressed_proof = proof_result.proof.0.ok_or("settle requires a validity proof")?;

    let mut light_context = Vec::with_capacity(LIGHT_CONTEXT_LEN);
    light_context.extend_from_slice(&compressed_proof.a);
    light_context.extend_from_slice(&compressed_proof.b);
    light_context.extend_from_slice(&compressed_proof.c);
    light_context.extend_from_slice(&authority_address);
    light_context.extend_from_slice(&authority_created_slot.to_le_bytes());
    light_context.extend_from_slice(&account_inputs.root_index.root_index().unwrap_or(0).to_le_bytes());
    light_context.push(account_inputs.root_index.proof_by_index() as u8);
    light_context.extend_from_slice(&(account_inputs.leaf_index as u32).to_le_bytes());
    light_context.extend_from_slice(&proof_result.addresses[0].root_index.to_le_bytes());
    let light_context: [u8; LIGHT_CONTEXT_LEN] = light_context.try_into().unwrap();

    let ix = settle_ix(
        pool,
        &operator.pubkey(),
        pull,
        beta,
        proof,
        &light_context,
        [authority_tree, authority_queue, address_tree, output_queue],
    );
    let compute_budget = ComputeBudgetInstruction::set_compute_unit_limit(600_000);
    rpc.create_and_send_transaction(&[compute_budget, ix], &operator.pubkey(), &[operator])
        .await
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

async fn env_settle(env: &mut Env, pull: &Pubkey, beta: &[u8; 64], proof: &[u8; 80]) -> Result<(), String> {
    let pool = env.pool;
    send_settle(
        &mut env.rpc,
        &pool,
        &env.operator,
        pull,
        beta,
        proof,
        env.authority_address,
        env.authority_created_slot,
    )
    .await
}

fn claim_ix(pool: &Pubkey, pull: &Pubkey, buyer: &Pubkey, payer: &Pubkey) -> Instruction {
    let mint = mint_pda(pull);
    Instruction {
        program_id: GACHA_ID,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*pool, false),
            AccountMeta::new(*pull, false),
            AccountMeta::new_readonly(*buyer, false),
            AccountMeta::new(mint, false),
            AccountMeta::new(ata(buyer, &mint), false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(TOKEN_2022_ID, false),
            AccountMeta::new_readonly(ATA_PROGRAM_ID, false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(GACHA_ID, false),
        ],
        data: vec![5u8],
    }
}

fn refund_ix(pool: &Pubkey, vault: &Pubkey, pull: &Pubkey, buyer: &Pubkey) -> Instruction {
    Instruction {
        program_id: GACHA_ID,
        accounts: vec![
            AccountMeta::new(*buyer, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*pull, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(event_authority(), false),
            AccountMeta::new_readonly(GACHA_ID, false),
        ],
        data: vec![3u8],
    }
}

// ---------------------------------------------------------------------------
// State readers (fields copied out of the packed structs)
// ---------------------------------------------------------------------------

struct PoolView {
    admin: [u8; 32],
    pulls_count: u64,
    pending_pulls: u64,
}

async fn read_pool(rpc: &mut LightProgramTest, pool: &Pubkey) -> PoolView {
    let account = rpc.get_account(*pool).await.expect("get pool account").expect("pool exists");
    let p = Pool::load(&account.data).expect("valid pool");
    let admin = p.admin;
    PoolView { admin: admin.to_bytes(), pulls_count: p.pulls_count, pending_pulls: p.pending_pulls }
}

struct PullView {
    status: u8,
    tier_selected: u8,
    alpha: [u8; 32],
    beta: [u8; 64],
}

async fn read_pull(rpc: &mut LightProgramTest, pull: &Pubkey) -> PullView {
    let account = rpc.get_account(*pull).await.expect("get pull account").expect("pull exists");
    let p = Pull::load(&account.data).expect("valid pull");
    PullView { status: p.status, tier_selected: p.tier_selected, alpha: p.alpha, beta: p.beta }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn settle_records_tier_and_anchors_commit() {
    let mut env = setup(true).await;
    let (pull, client_seed) = buy_pull(&mut env.rpc, &env.pool, &env.buyer).await;

    assert_eq!(read_pool(&mut env.rpc, &env.pool).await.pending_pulls, 1);

    let alpha = {
        let mut input = pull.to_bytes().to_vec();
        input.extend_from_slice(&client_seed);
        sha256(&input)
    };
    assert_eq!(read_pull(&mut env.rpc, &pull).await.alpha, alpha);

    let proof = [42u8; 80];
    let beta = beta_from(95); // weights [70, 25, 5]: 95 walks past 70 and 25 -> tier 2
    env_settle(&mut env, &pull, &beta, &proof).await.expect("settle_pull");

    let view = read_pull(&mut env.rpc, &pull).await;
    assert_eq!(view.status, PullStatus::Settled as u8);
    assert_eq!(view.tier_selected, expected_tier(&beta));
    assert_eq!(view.tier_selected, 2);
    assert_eq!(view.beta, beta);
    assert_eq!(read_pool(&mut env.rpc, &env.pool).await.pending_pulls, 0);

    // The reveal is anchored in the cc-vrf registry: a compressed account at
    // (authority, sha256(pull)) carrying the hashes and beta verbatim.
    let memo_hash = sha256(pull.as_ref());
    let commit_addr = commit_address(&env.rpc, &env.authority_address, &memo_hash);
    let commit_account = env
        .rpc
        .get_compressed_account(commit_addr, None)
        .await
        .expect("fetch commit")
        .value
        .expect("registry commit must exist");
    let commit = decode_vrf_commit(&commit_account);
    assert_eq!(commit.authority, env.authority_address);
    assert_eq!(commit.memo_hash, memo_hash);
    assert_eq!(commit.proof_hash, sha256(&proof));
    assert_eq!(commit.alpha_hash, sha256(&alpha));
    assert_eq!(commit.beta_lo[..], beta[..32]);
    assert_eq!(commit.beta_hi[..], beta[32..]);
}

#[tokio::test]
async fn settle_replay_rejected() {
    let mut env = setup(true).await;
    let (pull, _) = buy_pull(&mut env.rpc, &env.pool, &env.buyer).await;

    let proof = [42u8; 80];
    let beta = beta_from(10);
    env_settle(&mut env, &pull, &beta, &proof).await.expect("first settle");

    // Re-roll attempt through the gacha program: rejected by the status check
    // before the CPI is even reached (the light context can be garbage).
    let rerolled_beta = beta_from(99);
    let ix = settle_ix(
        &env.pool,
        &env.operator.pubkey(),
        &pull,
        &rerolled_beta,
        &proof,
        &[0u8; LIGHT_CONTEXT_LEN],
        [Pubkey::new_unique(), Pubkey::new_unique(), CANONICAL_ADDRESS_TREE_V2, Pubkey::new_unique()],
    );
    let compute_budget = ComputeBudgetInstruction::set_compute_unit_limit(600_000);
    let err = env
        .rpc
        .create_and_send_transaction(&[compute_budget, ix], &env.operator.pubkey(), &[&env.operator])
        .await
        .map_err(|e| format!("{e:?}"))
        .expect_err("re-roll through gacha must fail");
    assert_gacha_err(&err, gacha::GachaError::PullNotPending);

    // The marquee guarantee: even bypassing the gacha program entirely, the
    // operator cannot commit a second reveal for the same pull — the commit
    // address (authority, sha256(pull)) already exists in the registry.
    let memo_hash = sha256(pull.as_ref());
    let outcome = try_replay_commit(&mut env.rpc, &env.operator, env.authority_address, memo_hash).await;
    assert!(
        !matches!(outcome, ReplayOutcome::Landed),
        "registry must block a second commit for the same pull, got {outcome:?}"
    );

    // The original reveal is untouched.
    let view = read_pull(&mut env.rpc, &pull).await;
    assert_eq!(view.status, PullStatus::Settled as u8);
    assert_eq!(view.beta, beta);
}

#[tokio::test]
async fn settle_by_unfrozen_authority_rejected() {
    let mut env = setup(false).await;
    let (pull, _) = buy_pull(&mut env.rpc, &env.pool, &env.buyer).await;

    // The program pins frozen = true into the CPI'd authority record; the
    // actual registration is unfrozen, so its hash (bound by the validity
    // proof) cannot match and the settle fails inside the Light stack.
    let err =
        env_settle(&mut env, &pull, &beta_from(1), &[42u8; 80]).await.expect_err("unfrozen authority must not settle");
    assert!(!err.is_empty());

    let view = read_pull(&mut env.rpc, &pull).await;
    assert_eq!(view.status, PullStatus::Pending as u8);
    assert_eq!(read_pool(&mut env.rpc, &env.pool).await.pending_pulls, 1);
}

#[tokio::test]
async fn settle_by_unregistered_operator_rejected() {
    let mut env = setup(true).await;

    // A second pool whose operator was never registered in cc-vrf. The settle
    // is signed by that operator and reuses the frozen record of the first
    // operator — but the program serializes owner/pk from pool state, so the
    // record hash bound by the proof cannot match.
    let admin2 = Keypair::new();
    let operator2 = Keypair::new();
    for kp in [&admin2, &operator2] {
        env.rpc.airdrop_lamports(&kp.pubkey(), 100 * LAMPORTS_PER_SOL).await.expect("airdrop");
    }
    let (pool2, _) = init_pool(&mut env.rpc, &admin2, &operator2.pubkey()).await;
    let (pull2, _) = buy_pull(&mut env.rpc, &pool2, &env.buyer).await;

    let authority_address = env.authority_address;
    let authority_created_slot = env.authority_created_slot;
    let err = send_settle(
        &mut env.rpc,
        &pool2,
        &operator2,
        &pull2,
        &beta_from(1),
        &[42u8; 80],
        authority_address,
        authority_created_slot,
    )
    .await
    .expect_err("unregistered operator must not settle");
    assert!(!err.is_empty());

    let view = read_pull(&mut env.rpc, &pull2).await;
    assert_eq!(view.status, PullStatus::Pending as u8);
}

#[tokio::test]
async fn claim_after_real_settle_mints_prize() {
    let mut env = setup(true).await;
    let (pull, _) = buy_pull(&mut env.rpc, &env.pool, &env.buyer).await;

    let beta = beta_from(0); // tier 0 -> "common"
    env_settle(&mut env, &pull, &beta, &[42u8; 80]).await.expect("settle_pull");

    let buyer = env.buyer.pubkey();
    let ix = claim_ix(&env.pool, &pull, &buyer, &buyer);
    let compute_budget = ComputeBudgetInstruction::set_compute_unit_limit(400_000);
    env.rpc
        .create_and_send_transaction(&[compute_budget, ix], &buyer, &[&env.buyer])
        .await
        .expect("claim_prize tx failed");

    let mint = mint_pda(&pull);
    let mint_account = env.rpc.get_account(mint).await.expect("get mint").expect("mint exists");
    assert_eq!(mint_account.owner, TOKEN_2022_ID);

    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_account.data).expect("valid mint");
    assert_eq!(mint_state.base.decimals, 0);
    assert_eq!(mint_state.base.supply, 1);
    assert!(mint_state.base.mint_authority.is_none());

    let pointer = mint_state.get_extension::<MetadataPointer>().expect("metadata pointer");
    assert_eq!(pointer.metadata_address.0.to_bytes(), mint.to_bytes());
    assert_eq!(pointer.authority.0.to_bytes(), env.pool.to_bytes());

    let metadata = mint_state.get_variable_len_extension::<TokenMetadata>().expect("token metadata");
    assert_eq!(metadata.name, format!("{}0", gacha::NFT_NAME_PREFIX));
    assert_eq!(metadata.symbol, gacha::NFT_SYMBOL);
    assert_eq!(metadata.uri, gacha::NFT_URI);
    assert_eq!(metadata.mint.to_bytes(), mint.to_bytes());
    assert_eq!(metadata.update_authority.0.to_bytes(), env.pool.to_bytes());
    assert_eq!(metadata.additional_metadata, vec![("rarity".to_string(), gacha::RARITY_LABELS[0].to_string())]);

    let ata_account = env.rpc.get_account(ata(&buyer, &mint)).await.expect("get ata").expect("buyer ata exists");
    let ata_state = StateWithExtensions::<TokenAccount>::unpack(&ata_account.data).expect("valid token account");
    assert_eq!(ata_state.base.amount, 1);
    assert_eq!(ata_state.base.owner.to_bytes(), buyer.to_bytes());
    assert_eq!(ata_state.base.mint.to_bytes(), mint.to_bytes());

    let view = read_pull(&mut env.rpc, &pull).await;
    assert_eq!(view.status, PullStatus::Claimed as u8);
}

#[tokio::test]
async fn refund_after_settle_rejected() {
    let mut env = setup(true).await;
    let (pull, _) = buy_pull(&mut env.rpc, &env.pool, &env.buyer).await;

    env_settle(&mut env, &pull, &beta_from(1), &[42u8; 80]).await.expect("settle_pull");

    // A settled pull is operator revenue: the buyer's escape hatch is gone.
    let buyer = env.buyer.pubkey();
    let ix = refund_ix(&env.pool, &env.vault, &pull, &buyer);
    let err = env
        .rpc
        .create_and_send_transaction(&[ix], &buyer, &[&env.buyer])
        .await
        .map_err(|e| format!("{e:?}"))
        .expect_err("refund after settle must fail");
    assert_gacha_err(&err, gacha::GachaError::PullNotPending);

    let view = read_pull(&mut env.rpc, &pull).await;
    assert_eq!(view.status, PullStatus::Settled as u8);
}
