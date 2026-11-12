use litesvm::{types::TransactionResult, LiteSVM};
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

use crate::{
    children,
    tests::{
        constants::{EVENT_AUTHORITY, PROGRAM_ID, SYSTEM_PROGRAM_ID},
        pda::{get_bracket_pda, get_config_pda, get_oracle_pda, get_vault_pda},
    },
    third_place_slots,
    utils::cu_tracker::record_cu,
    Bracket, Config, Oracle, WorldCupInstruction,
};

/// Baseline wall-clock the test SVM starts at.
pub const BASE_TS: i64 = 1_700_000_000;
/// Lock timestamp used by the helpers (kickoff one day after the baseline).
pub const LOCK_TS: i64 = BASE_TS + 86_400;

pub fn setup() -> (LiteSVM, Keypair) {
    let mut litesvm = LiteSVM::new();

    let so_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/world_cup_program.so");
    litesvm.add_program_from_file(PROGRAM_ID.to_bytes(), so_path).unwrap();

    let admin = Keypair::new();
    litesvm.airdrop(&admin.pubkey(), LAMPORTS_PER_SOL * 100).unwrap();
    set_unix_timestamp(&mut litesvm, BASE_TS);

    (litesvm, admin)
}

pub fn set_unix_timestamp(litesvm: &mut LiteSVM, ts: i64) {
    let mut clock: Clock = litesvm.get_sysvar();
    clock.unix_timestamp = ts;
    litesvm.set_sysvar(&clock);
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
        if let Ok(parsed) = WorldCupInstruction::from_bytes(&ix.data) {
            record_cu(&parsed.to_string(), meta.compute_units_consumed);
        }
    }
    litesvm.expire_blockhash();
    result
}

/// A "chalk" bracket where the lower-id team always advances (champion = team 0).
/// Identical shape to a full chalk oracle result array.
pub fn chalk_bracket() -> [u8; 32] {
    let mut p = [0u8; 32];
    for g in 0..16u8 {
        p[g as usize] = 2 * g;
    }
    for g in 16..=30u8 {
        let (c0, c1) = children(g);
        p[g as usize] = p[c0 as usize].min(p[c1 as usize]);
    }
    let (l0, l1) = third_place_slots(&p);
    p[31] = l0.min(l1);
    p
}

/// A valid bracket identical to chalk except the third-place pick is the *other*
/// semifinal loser, so against a chalk oracle it loses exactly the third-place game.
pub fn chalk_bracket_wrong_third() -> [u8; 32] {
    let mut p = chalk_bracket();
    let (l0, l1) = third_place_slots(&p);
    p[31] = l0.max(l1);
    p
}

#[allow(clippy::result_large_err)]
pub fn init_config(litesvm: &mut LiteSVM, admin: &Keypair, lock_ts: i64) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (oracle, _) = get_oracle_pda();
    let (vault, _) = get_vault_pda();

    let mut data = vec![*crate::init_config::DISCRIMINATOR];
    data.extend_from_slice(&lock_ts.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(admin.pubkey(), true),
        AccountMeta::new(config, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];

    let ix = Instruction { program_id: PROGRAM_ID, accounts, data };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn submit_bracket(
    litesvm: &mut LiteSVM,
    entrant: &Keypair,
    picks: &[u8; 32],
    tiebreaker_guess: u16,
) -> (TransactionResult, Pubkey) {
    let (config, _) = get_config_pda();
    let (vault, _) = get_vault_pda();
    let (bracket, _) = get_bracket_pda(&entrant.pubkey());

    let mut data = vec![*crate::submit_bracket::DISCRIMINATOR];
    data.extend_from_slice(picks);
    data.extend_from_slice(&tiebreaker_guess.to_le_bytes());

    let accounts = vec![
        AccountMeta::new(entrant.pubkey(), true),
        AccountMeta::new(config, false),
        AccountMeta::new(bracket, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];

    let ix = Instruction { program_id: PROGRAM_ID, accounts, data };
    (build_and_send(litesvm, &[entrant], &entrant.pubkey(), &ix), bracket)
}

#[allow(clippy::result_large_err)]
pub fn lock(litesvm: &mut LiteSVM, admin: &Keypair) -> TransactionResult {
    let (config, _) = get_config_pda();
    let accounts = vec![
        AccountMeta::new_readonly(admin.pubkey(), true),
        AccountMeta::new(config, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::lock::DISCRIMINATOR] };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn post_result(litesvm: &mut LiteSVM, admin: &Keypair, game: u8, winner: u8) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (oracle, _) = get_oracle_pda();
    let accounts = vec![
        AccountMeta::new_readonly(admin.pubkey(), true),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix =
        Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::post_result::DISCRIMINATOR, game, winner] };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn post_goals(litesvm: &mut LiteSVM, admin: &Keypair, total: u16) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (oracle, _) = get_oracle_pda();
    let mut data = vec![*crate::post_goals::DISCRIMINATOR];
    data.extend_from_slice(&total.to_le_bytes());
    let accounts = vec![
        AccountMeta::new_readonly(admin.pubkey(), true),
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(oracle, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn refresh_score(litesvm: &mut LiteSVM, payer: &Keypair, bracket_owner: &Pubkey) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (oracle, _) = get_oracle_pda();
    let (bracket, _) = get_bracket_pda(bracket_owner);
    let accounts = vec![
        AccountMeta::new(config, false),
        AccountMeta::new_readonly(oracle, false),
        AccountMeta::new(bracket, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::refresh_score::DISCRIMINATOR] };
    build_and_send(litesvm, &[payer], &payer.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn finalize(litesvm: &mut LiteSVM, admin: &Keypair, winning_bracket_owner: &Pubkey) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (oracle, _) = get_oracle_pda();
    let (bracket, _) = get_bracket_pda(winning_bracket_owner);
    let accounts = vec![
        AccountMeta::new(admin.pubkey(), true),
        AccountMeta::new(config, false),
        AccountMeta::new_readonly(oracle, false),
        AccountMeta::new_readonly(bracket, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::finalize::DISCRIMINATOR] };
    build_and_send(litesvm, &[admin], &admin.pubkey(), &ix)
}

#[allow(clippy::result_large_err)]
pub fn claim(litesvm: &mut LiteSVM, winner: &Keypair) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (vault, _) = get_vault_pda();
    let accounts = vec![
        AccountMeta::new(winner.pubkey(), true),
        AccountMeta::new(config, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::claim::DISCRIMINATOR] };
    build_and_send(litesvm, &[winner], &winner.pubkey(), &ix)
}

/// Snapshot of the config fields tests assert on (copied out of the packed struct).
pub struct ConfigView {
    pub state: u8,
    pub entrant_count: u32,
    pub refreshed_count: u32,
    pub tally_mask: u32,
    pub best_score: u16,
    pub best_closeness: u16,
    pub best_index: u32,
    pub winner: [u8; 32],
}

pub fn read_config(litesvm: &LiteSVM) -> ConfigView {
    let (config, _) = get_config_pda();
    let account = litesvm.get_account(&config).expect("config exists");
    let c = Config::load(&account.data).expect("valid config");
    ConfigView {
        state: c.state,
        entrant_count: c.entrant_count,
        refreshed_count: c.refreshed_count,
        tally_mask: c.tally_mask,
        best_score: c.best_score,
        best_closeness: c.best_closeness,
        best_index: c.best_index,
        winner: c.winner.to_bytes(),
    }
}

pub fn oracle_decided_mask(litesvm: &LiteSVM) -> u32 {
    let (oracle, _) = get_oracle_pda();
    let account = litesvm.get_account(&oracle).expect("oracle exists");
    Oracle::load(&account.data).expect("valid oracle").decided_mask
}

/// Returns `(score, tally_mask)` for a bracket.
pub fn read_bracket(litesvm: &LiteSVM, owner: &Pubkey) -> (u16, u32) {
    let (bracket, _) = get_bracket_pda(owner);
    let account = litesvm.get_account(&bracket).expect("bracket exists");
    let b = Bracket::load(&account.data).expect("valid bracket");
    (b.score, b.tally_mask)
}

pub fn vault_balance(litesvm: &LiteSVM) -> u64 {
    let (vault, _) = get_vault_pda();
    litesvm.get_account(&vault).map(|a| a.lamports).unwrap_or(0)
}

/// Initializes the tournament and advances to the locked (oracle-posting) phase.
pub fn init_and_lock(litesvm: &mut LiteSVM, admin: &Keypair) {
    init_config(litesvm, admin, LOCK_TS).expect("init_config should succeed");
    set_unix_timestamp(litesvm, LOCK_TS);
    lock(litesvm, admin).expect("lock should succeed");
}

#[allow(clippy::result_large_err)]
pub fn close_bracket(litesvm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey) -> TransactionResult {
    let (config, _) = get_config_pda();
    let (bracket, _) = get_bracket_pda(owner);
    let (vault, _) = get_vault_pda();
    let accounts = vec![
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(bracket, false),
        AccountMeta::new(vault, false),
        AccountMeta::new_readonly(EVENT_AUTHORITY, false),
        AccountMeta::new_readonly(PROGRAM_ID, false),
    ];
    let ix = Instruction { program_id: PROGRAM_ID, accounts, data: vec![*crate::close_bracket::DISCRIMINATOR] };
    build_and_send(litesvm, &[payer], &payer.pubkey(), &ix)
}

/// Posts every chalk game result in feeder-before-dependent order (no goal total).
pub fn post_all_chalk_results(litesvm: &mut LiteSVM, admin: &Keypair) {
    let results = chalk_bracket();
    for game in 0..32u8 {
        post_result(litesvm, admin, game, results[game as usize]).expect("post_result should succeed");
    }
}

/// Posts every chalk game result and then the goal total.
pub fn post_full_chalk_oracle(litesvm: &mut LiteSVM, admin: &Keypair, total_goals: u16) {
    post_all_chalk_results(litesvm, admin);
    post_goals(litesvm, admin, total_goals).expect("post_goals should succeed");
}
