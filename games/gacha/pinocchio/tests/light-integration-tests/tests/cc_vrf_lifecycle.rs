//! Integration spike: prove that the mainnet cc-vrf program binary works inside
//! light-program-test (LiteSVM + local prover + TestIndexer).
//!
//! Flow: init_authority -> freeze_authority -> commit_proof_with_beta -> replay (must fail).

mod common;

use common::*;
use light_program_test::{program_test::LightProgramTest, AddressWithTree, Indexer, ProgramTestConfig, Rpc};
use solana_sdk::{pubkey::Pubkey, signature::Signer};

#[tokio::test]
async fn cc_vrf_lifecycle() {
    // (a) Boot LightProgramTest with cc_vrf.so (populated by `just dump-cc-vrf`)
    // loaded via SBF_OUT_DIR.
    let fixtures = format!("{}/../fixtures", env!("CARGO_MANIFEST_DIR"));
    std::env::set_var("SBF_OUT_DIR", &fixtures);

    let config = ProgramTestConfig::new(true, Some(vec![("cc_vrf", CC_VRF_ID)]));
    let mut rpc = LightProgramTest::new(config).await.expect("boot failed");
    let payer = rpc.get_payer().insecure_clone();

    // (b) The env's v2 address tree must be the canonical mainnet tree cc-vrf pins.
    let address_tree = rpc.get_address_tree_v2().tree;
    assert_eq!(address_tree, CANONICAL_ADDRESS_TREE_V2, "v2 address tree is NOT canonical; cc-vrf would reject it");

    // Sanity: light-sdk derives the same cpi authority PDA cc-vrf uses.
    let derived_cpi_authority = Pubkey::find_program_address(&[b"cpi_authority"], &CC_VRF_ID).0;
    assert_eq!(derived_cpi_authority, CC_VRF_CPI_AUTHORITY);

    // (c)-(e) init_authority + freeze_authority (field asserts live in the helper).
    let label = [7u8; 32];
    let (authority_address, authority_state) = register_authority(&mut rpc, &payer, label, true).await;
    println!(
        "init_authority + freeze_authority OK: created_slot={} frozen={}",
        authority_state.created_slot, authority_state.frozen
    );

    // (f) commit_proof_with_beta -------------------------------------------
    let memo_hash = [1u8; 32];
    let proof_hash = [2u8; 32];
    let alpha_hash = [3u8; 32];
    let beta_lo = [4u8; 32];
    let beta_hi = [5u8; 32];

    let commit_address = commit_address(&rpc, &authority_address, &memo_hash);
    let authority_account = fetch_authority(&mut rpc, authority_address).await;

    // One proof: authority inclusion + commit address non-inclusion.
    let proof_result = rpc
        .get_validity_proof(
            vec![authority_account.hash],
            vec![AddressWithTree { address: commit_address, tree: address_tree }],
            None,
        )
        .await
        .expect("combined proof for commit")
        .value;

    let commit_ix = build_commit_ix(
        &proof_result,
        &payer.pubkey(),
        authority_address,
        &authority_state,
        memo_hash,
        proof_hash,
        alpha_hash,
        beta_lo,
        beta_hi,
    );
    rpc.create_and_send_transaction(&[commit_ix], &payer.pubkey(), &[&payer])
        .await
        .expect("commit_proof_with_beta tx failed");

    let commit_account = rpc
        .get_compressed_account(commit_address, None)
        .await
        .expect("fetch commit")
        .value
        .expect("commit account must exist");
    let commit_state = decode_vrf_commit(&commit_account);
    assert_eq!(commit_state.authority, authority_address);
    assert_eq!(commit_state.memo_hash, memo_hash);
    assert_eq!(commit_state.proof_hash, proof_hash);
    assert_eq!(commit_state.alpha_hash, alpha_hash);
    assert_eq!(commit_state.beta_lo, beta_lo);
    assert_eq!(commit_state.beta_hi, beta_hi);
    println!(
        "commit_proof_with_beta OK: authority_field={:?} committed_slot={}",
        Pubkey::new_from_array(commit_state.authority),
        commit_state.committed_slot
    );

    // (g) REPLAY: same commit again must fail (address already exists).
    let outcome = try_replay_commit(&mut rpc, &payer, authority_address, memo_hash).await;
    assert!(!matches!(outcome, ReplayOutcome::Landed), "replayed commit must be blocked, got {outcome:?}");
    println!("replay blocked (expected): {outcome:?}");
}
