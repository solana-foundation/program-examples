//! Shared cc-vrf plumbing for the Light-stack tests: instruction
//! discriminators, borsh mirrors of the on-chain state, and builders for
//! registering (and freezing) a VRF authority and committing a proof.
//!
//! Everything here mirrors cc-vrf's committed Anchor IDL
//! (`../fixtures/cc_vrf_idl.json`); an Anchor instruction is accounts plus
//! borsh args behind an 8-byte discriminator, so the tests hand-build them.
#![allow(dead_code)]

use borsh::{BorshDeserialize, BorshSerialize};
use light_client::indexer::{CompressedAccount, ValidityProofWithContext};
use light_program_test::{program_test::LightProgramTest, AddressWithTree, Indexer, Rpc};
use light_sdk::address::v2::derive_address;
use light_sdk::instruction::{
    account_meta::{CompressedAccountMeta, CompressedAccountMetaReadOnly},
    PackedAccounts, PackedAddressTreeInfo, SystemAccountMetaConfig, ValidityProof,
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use solana_system_interface::program as system_program;

pub const CC_VRF_ID: Pubkey = pubkey!("ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ");
pub const CC_VRF_CPI_AUTHORITY: Pubkey = pubkey!("JEwC9hjj9yfWCQZQsMvy8zG92CcThefPxEp5T63UCFD");
pub const CANONICAL_ADDRESS_TREE_V2: Pubkey = pubkey!("amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx");

// Anchor instruction discriminators from the committed IDL.
pub const DISC_INIT_AUTHORITY: [u8; 8] = [136, 150, 94, 172, 74, 199, 236, 85];
pub const DISC_FREEZE_AUTHORITY: [u8; 8] = [59, 124, 222, 89, 27, 146, 178, 7];
pub const DISC_COMMIT_PROOF_WITH_BETA: [u8; 8] = [199, 253, 178, 3, 187, 191, 68, 230];

/// RFC 9381 ciphersuite id for `ECVRF-EDWARDS25519-SHA512-TAI`.
pub const SUITE_TAI: u8 = 3;

/// Mirror of the on-chain VrfAuthority state (IDL field order).
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct VrfAuthority {
    pub owner: [u8; 32],
    pub pk: [u8; 32],
    pub suite: u8,
    pub frozen: bool,
    pub revoked: bool,
    pub label: [u8; 32],
    pub created_slot: u64,
}

/// Mirror of the on-chain VrfProofCommitWithBeta state (IDL field order).
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct VrfProofCommitWithBeta {
    pub authority: [u8; 32],
    pub memo_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub alpha_hash: [u8; 32],
    pub beta_lo: [u8; 32],
    pub beta_hi: [u8; 32],
    pub committed_slot: u64,
}

#[derive(BorshSerialize)]
pub struct InitAuthorityIx {
    pub proof: ValidityProof,
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
    pub pk: [u8; 32],
    pub suite: u8,
    pub label: [u8; 32],
}

#[derive(BorshSerialize)]
pub struct FreezeAuthorityIx {
    pub proof: ValidityProof,
    pub current_authority: VrfAuthority,
    pub account_meta: CompressedAccountMeta,
}

#[derive(BorshSerialize)]
pub struct CommitProofWithBetaIx {
    pub proof: ValidityProof,
    pub authority_account_meta: CompressedAccountMetaReadOnly,
    pub current_authority: VrfAuthority,
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
    pub memo_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub alpha_hash: [u8; 32],
    pub beta_lo: [u8; 32],
    pub beta_hi: [u8; 32],
}

pub fn decode_vrf_authority(account: &CompressedAccount) -> VrfAuthority {
    let data = account.data.as_ref().expect("authority account should have data");
    VrfAuthority::try_from_slice(&data.data).expect("borsh decode VrfAuthority")
}

pub fn decode_vrf_commit(account: &CompressedAccount) -> VrfProofCommitWithBeta {
    let data = account.data.as_ref().expect("commit account should have data");
    VrfProofCommitWithBeta::try_from_slice(&data.data).expect("borsh decode VrfProofCommitWithBeta")
}

pub fn ix_data<T: BorshSerialize>(disc: [u8; 8], args: &T) -> Vec<u8> {
    [&disc[..], &args.try_to_vec().unwrap()[..]].concat()
}

/// Derives the compressed address of an owner's VrfAuthority record.
pub fn authority_address(rpc: &LightProgramTest, owner: &Pubkey, label: &[u8; 32]) -> [u8; 32] {
    let address_tree = rpc.get_address_tree_v2().tree;
    derive_address(&[b"vrf_authority", owner.as_ref(), label], &address_tree, &CC_VRF_ID).0
}

/// Derives the compressed address of a proof commit for `(authority, memo_hash)`.
pub fn commit_address(rpc: &LightProgramTest, authority_address: &[u8; 32], memo_hash: &[u8; 32]) -> [u8; 32] {
    let address_tree = rpc.get_address_tree_v2().tree;
    derive_address(&[b"vrf_proof", authority_address, memo_hash], &address_tree, &CC_VRF_ID).0
}

/// Registers `owner` as a cc-vrf authority under `label` (owner doubles as the
/// ECVRF public key), optionally freezing the record, and returns its
/// compressed address plus decoded state. The owner must already be funded.
pub async fn register_authority(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    label: [u8; 32],
    freeze: bool,
) -> ([u8; 32], VrfAuthority) {
    let address_tree = rpc.get_address_tree_v2().tree;
    let authority_address = authority_address(rpc, &owner.pubkey(), &label);

    let proof_result = rpc
        .get_validity_proof(vec![], vec![AddressWithTree { address: authority_address, tree: address_tree }], None)
        .await
        .expect("non-inclusion proof for authority address")
        .value;

    let mut accounts = PackedAccounts::default();
    accounts.add_pre_accounts_signer_mut(owner.pubkey());
    // init_authority names `system_program` as its second Anchor account.
    accounts.add_pre_accounts_meta(AccountMeta::new_readonly(system_program::ID, false));
    accounts.add_system_accounts_v2(SystemAccountMetaConfig::new(CC_VRF_ID)).unwrap();

    let output_state_tree_index =
        rpc.get_random_state_tree_info().unwrap().pack_output_tree_index(&mut accounts).unwrap();
    let packed_address_tree_info = proof_result.pack_tree_infos(&mut accounts).address_trees[0];
    let (metas, _, _) = accounts.to_account_metas();

    let init_ix = Instruction {
        program_id: CC_VRF_ID,
        accounts: metas,
        data: ix_data(
            DISC_INIT_AUTHORITY,
            &InitAuthorityIx {
                proof: proof_result.proof,
                address_tree_info: packed_address_tree_info,
                output_state_tree_index,
                pk: owner.pubkey().to_bytes(),
                suite: SUITE_TAI,
                label,
            },
        ),
    };
    rpc.create_and_send_transaction(&[init_ix], &owner.pubkey(), &[owner]).await.expect("init_authority tx failed");

    let authority_account = fetch_authority(rpc, authority_address).await;
    let mut authority_state = decode_vrf_authority(&authority_account);
    assert_eq!(authority_state.owner, owner.pubkey().to_bytes());
    assert_eq!(authority_state.pk, owner.pubkey().to_bytes());
    assert_eq!(authority_state.suite, SUITE_TAI);
    assert_eq!(authority_state.label, label);
    assert!(!authority_state.frozen);
    assert!(!authority_state.revoked);

    if freeze {
        let proof_result = rpc
            .get_validity_proof(vec![authority_account.hash], vec![], None)
            .await
            .expect("inclusion proof for authority")
            .value;

        let mut accounts = PackedAccounts::default();
        accounts.add_pre_accounts_signer_mut(owner.pubkey());
        accounts.add_system_accounts_v2(SystemAccountMetaConfig::new(CC_VRF_ID)).unwrap();
        let packed_state = proof_result.pack_tree_infos(&mut accounts).state_trees.unwrap();
        let (metas, _, _) = accounts.to_account_metas();

        let freeze_ix = Instruction {
            program_id: CC_VRF_ID,
            accounts: metas,
            data: ix_data(
                DISC_FREEZE_AUTHORITY,
                &FreezeAuthorityIx {
                    proof: proof_result.proof,
                    current_authority: authority_state.clone(),
                    account_meta: CompressedAccountMeta {
                        tree_info: packed_state.packed_tree_infos[0],
                        address: authority_address,
                        output_state_tree_index: packed_state.output_tree_index,
                    },
                },
            ),
        };
        rpc.create_and_send_transaction(&[freeze_ix], &owner.pubkey(), &[owner])
            .await
            .expect("freeze_authority tx failed");

        authority_state = decode_vrf_authority(&fetch_authority(rpc, authority_address).await);
        assert!(authority_state.frozen, "authority must be frozen");
    }

    (authority_address, authority_state)
}

pub async fn fetch_authority(rpc: &mut LightProgramTest, authority_address: [u8; 32]) -> CompressedAccount {
    rpc.get_compressed_account(authority_address, None)
        .await
        .expect("fetch authority")
        .value
        .expect("authority account must exist")
}

/// Builds a top-level `commit_proof_with_beta` instruction from a combined
/// validity proof (authority inclusion + commit address non-inclusion).
#[allow(clippy::too_many_arguments)]
pub fn build_commit_ix(
    proof_result: &ValidityProofWithContext,
    owner: &Pubkey,
    authority_address: [u8; 32],
    authority_state: &VrfAuthority,
    memo_hash: [u8; 32],
    proof_hash: [u8; 32],
    alpha_hash: [u8; 32],
    beta_lo: [u8; 32],
    beta_hi: [u8; 32],
) -> Instruction {
    let mut accounts = PackedAccounts::default();
    accounts.add_pre_accounts_signer_mut(*owner);
    accounts.add_system_accounts_v2(SystemAccountMetaConfig::new(CC_VRF_ID)).unwrap();
    let packed = proof_result.pack_tree_infos(&mut accounts);
    let packed_state = packed.state_trees.unwrap();
    let packed_address_tree_info = packed.address_trees[0];
    let (metas, _, _) = accounts.to_account_metas();

    Instruction {
        program_id: CC_VRF_ID,
        accounts: metas,
        data: ix_data(
            DISC_COMMIT_PROOF_WITH_BETA,
            &CommitProofWithBetaIx {
                proof: proof_result.proof,
                authority_account_meta: CompressedAccountMetaReadOnly {
                    tree_info: packed_state.packed_tree_infos[0],
                    address: authority_address,
                },
                current_authority: authority_state.clone(),
                address_tree_info: packed_address_tree_info,
                output_state_tree_index: packed_state.output_tree_index,
                memo_hash,
                proof_hash,
                alpha_hash,
                beta_lo,
                beta_hi,
            },
        ),
    }
}

/// How a repeated commit for the same `(authority, memo_hash)` was stopped.
#[derive(Debug)]
pub enum ReplayOutcome {
    /// The indexer refused to build a non-inclusion proof for an existing address.
    BlockedAtProofGeneration,
    /// The transaction was rejected on-chain (batched address queue duplicate).
    BlockedOnChain,
    /// The commit landed — the registry failed to enforce one reveal per memo.
    Landed,
}

/// Attempts a second `commit_proof_with_beta` for `(authority, memo_hash)`.
/// The registry must block it, either at proof generation or on-chain.
pub async fn try_replay_commit(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    authority_address: [u8; 32],
    memo_hash: [u8; 32],
) -> ReplayOutcome {
    let address_tree = rpc.get_address_tree_v2().tree;
    let authority_account = fetch_authority(rpc, authority_address).await;
    let authority_state = decode_vrf_authority(&authority_account);
    let commit_address = commit_address(rpc, &authority_address, &memo_hash);

    let proof_result = rpc
        .get_validity_proof(
            vec![authority_account.hash],
            vec![AddressWithTree { address: commit_address, tree: address_tree }],
            None,
        )
        .await;

    let proof_result = match proof_result {
        Err(_) => return ReplayOutcome::BlockedAtProofGeneration,
        Ok(proof) => proof.value,
    };

    let replay_ix = build_commit_ix(
        &proof_result,
        &owner.pubkey(),
        authority_address,
        &authority_state,
        memo_hash,
        [2u8; 32],
        [3u8; 32],
        [4u8; 32],
        [5u8; 32],
    );
    match rpc.create_and_send_transaction(&[replay_ix], &owner.pubkey(), &[owner]).await {
        Err(_) => ReplayOutcome::BlockedOnChain,
        Ok(_) => ReplayOutcome::Landed,
    }
}
