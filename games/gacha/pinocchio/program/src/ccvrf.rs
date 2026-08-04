//! Hand-built CPI to Collector Crypt's cc-vrf registry program.
//! Src: https://github.com/collectorcrypt/cc-vrf
//!
//! cc-vrf is an Anchor program, but an Anchor instruction is just accounts plus
//! borsh-encoded data behind an 8-byte discriminator, so a Pinocchio program can
//! call it directly. `settle_pull` invokes `commit_proof_with_beta`, which
//! anchors the pull's `{memo_hash, proof_hash, alpha_hash, beta}` in the
//! registry as a Light Protocol compressed account whose address derives from
//! `(authority, memo_hash)` — committing twice for the same pull fails at the
//! Light system program, which is what gives each pull exactly one reveal.
//!
//! cc-vrf reads everything past its `owner` signer from *remaining accounts*
//! (the Light Protocol account set), and validates the operator's registered
//! authority record through a Light validity proof. The record's fields are
//! hashed into that proof, so this program serializes them from its own pool
//! state — an operator cannot substitute a different registration.

use light_sdk_types::constants as light;
use pinocchio::{cpi::invoke, instruction::InstructionAccount, instruction::InstructionView, Address, ProgramResult};

/// cc-vrf program (same address on mainnet and devnet).
pub const CC_VRF_PROGRAM_ID: Address = Address::from_str_const("ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ");
/// cc-vrf's CPI signer PDA (`["cpi_authority"]` under cc-vrf).
pub const CC_VRF_CPI_AUTHORITY: Address = Address::from_str_const("JEwC9hjj9yfWCQZQsMvy8zG92CcThefPxEp5T63UCFD");

/// Light system program.
pub const LIGHT_SYSTEM_PROGRAM_ID: Address = Address::new_from_array(light::LIGHT_SYSTEM_PROGRAM_ID);
/// Light registered-program PDA.
pub const REGISTERED_PROGRAM_PDA: Address = Address::new_from_array(light::REGISTERED_PROGRAM_PDA);
/// Account-compression CPI authority (`["cpi_authority"]` under the Light system program).
pub const ACCOUNT_COMPRESSION_AUTHORITY: Address = Address::new_from_array(light::ACCOUNT_COMPRESSION_AUTHORITY_PDA);
/// Light account-compression program.
pub const ACCOUNT_COMPRESSION_PROGRAM_ID: Address = Address::new_from_array(light::ACCOUNT_COMPRESSION_PROGRAM_ID);
/// The canonical Light v2 batched address tree; cc-vrf rejects any other.
pub const ADDRESS_TREE_V2: Address = Address::new_from_array(light::ADDRESS_TREE_V2);

/// Anchor discriminator for `commit_proof_with_beta`
/// (`sha256("global:commit_proof_with_beta")[..8]`).
const COMMIT_PROOF_WITH_BETA_DISC: [u8; 8] = [199, 253, 178, 3, 187, 191, 68, 230];

/// RFC 9381 ciphersuite id for `ECVRF-EDWARDS25519-SHA512-TAI`, the only suite
/// this program (and its off-chain verifier) supports.
const ECVRF_SUITE_TAI: u8 = 3;

/// Client-supplied Light Protocol context forwarded into the cc-vrf CPI: the
/// validity proof plus where the operator's authority record sits in the state
/// tree. Fetched off-chain from a Photon RPC (`getValidityProofV0`).
///
/// Everything else the CPI needs is either derived on-chain (the hashes), read
/// from pool state (the authority record fields), or fixed by this program's
/// account layout (the packed tree indices).
#[repr(C, packed)]
#[derive(codama::CodamaType, Debug, Clone, Copy)]
pub struct LightCommitContext {
    /// Groth16 validity proof (`a || b || c`), proving the authority record's
    /// inclusion and the new commit address's non-inclusion.
    pub validity_proof: [u8; 128],
    /// Compressed address of the operator's `VrfAuthority` record.
    pub authority_address: [u8; 32],
    /// Slot recorded in the authority record at registration; part of the
    /// record hash bound by the validity proof.
    pub authority_created_slot: u64,
    /// State-tree root index for the authority inclusion proof.
    pub authority_root_index: u16,
    /// Nonzero when the authority record is still in the tree's output queue
    /// and is proven by index instead of by root.
    pub authority_prove_by_index: u8,
    /// Leaf index of the authority record in its state tree.
    pub authority_leaf_index: u32,
    /// Address-tree root index for the new commit address's non-inclusion proof.
    pub address_tree_root_index: u16,
}

/// Byte length of the borsh-encoded `commit_proof_with_beta` instruction data.
const COMMIT_DATA_LEN: usize = 450;

/// Number of accounts forwarded to the cc-vrf CPI: the operator plus the ten
/// Light passthrough accounts.
pub const COMMIT_ACCOUNTS_LEN: usize = 11;

/// Borsh-encodes the `commit_proof_with_beta` instruction data.
///
/// The authority record (`owner`, `pk`, `label`) is serialized from pool state
/// with `suite = TAI`, `frozen = true`, `revoked = false`. The Light validity
/// proof binds the record's hash, so a settle only succeeds if the operator's
/// actual registration matches these exact values: frozen, unrevoked, and keyed
/// by `pool.operator` under `pool.authority_label`.
///
/// Packed account indices are relative to the tree slice of the remaining
/// accounts (after the six fixed Light system accounts): authority state tree =
/// 0, its queue = 1, address tree = 2, output queue = 3 — matching the order in
/// [`commit_proof_with_beta`].
#[allow(clippy::too_many_arguments)]
fn build_commit_data(
    operator: &Address,
    authority_label: &[u8; 32],
    ctx: &LightCommitContext,
    memo_hash: &[u8; 32],
    proof_hash: &[u8; 32],
    alpha_hash: &[u8; 32],
    beta: &[u8; 64],
) -> [u8; COMMIT_DATA_LEN] {
    let mut data = [0u8; COMMIT_DATA_LEN];

    data[0..8].copy_from_slice(&COMMIT_PROOF_WITH_BETA_DISC);

    // proof: Option<CompressedProof> — always Some for a with-beta commit.
    data[8] = 1;
    data[9..137].copy_from_slice(&ctx.validity_proof);

    // authority_account_meta: CompressedAccountMetaReadOnly.
    let authority_root_index = ctx.authority_root_index;
    let authority_leaf_index = ctx.authority_leaf_index;
    data[137..139].copy_from_slice(&authority_root_index.to_le_bytes());
    data[139] = (ctx.authority_prove_by_index != 0) as u8;
    data[140] = 0; // merkle_tree_pubkey_index
    data[141] = 1; // queue_pubkey_index
    data[142..146].copy_from_slice(&authority_leaf_index.to_le_bytes());
    data[146..178].copy_from_slice(&ctx.authority_address);

    // current_authority: VrfAuthority, pinned from pool state.
    let authority_created_slot = ctx.authority_created_slot;
    data[178..210].copy_from_slice(operator.as_ref()); // owner
    data[210..242].copy_from_slice(operator.as_ref()); // pk
    data[242] = ECVRF_SUITE_TAI;
    data[243] = 1; // frozen
    data[244] = 0; // revoked
    data[245..277].copy_from_slice(authority_label);
    data[277..285].copy_from_slice(&authority_created_slot.to_le_bytes());

    // address_tree_info: PackedAddressTreeInfo (tree and queue are the same
    // account for a v2 batched address tree).
    let address_tree_root_index = ctx.address_tree_root_index;
    data[285] = 2;
    data[286] = 2;
    data[287..289].copy_from_slice(&address_tree_root_index.to_le_bytes());

    data[289] = 3; // output_state_tree_index

    data[290..322].copy_from_slice(memo_hash);
    data[322..354].copy_from_slice(proof_hash);
    data[354..386].copy_from_slice(alpha_hash);
    data[386..418].copy_from_slice(&beta[..32]); // beta_lo
    data[418..450].copy_from_slice(&beta[32..]); // beta_hi

    data
}

/// Invokes cc-vrf `commit_proof_with_beta`.
///
/// `accounts` must be the operator followed by the ten Light passthrough
/// accounts in the order documented on
/// [`SettlePull`](crate::GachaInstruction::SettlePull). The operator's signature
/// propagates through the CPI; cc-vrf pays nothing itself.
#[allow(clippy::too_many_arguments)]
pub fn commit_proof_with_beta(
    accounts: &[&pinocchio::AccountView; COMMIT_ACCOUNTS_LEN],
    operator: &Address,
    authority_label: &[u8; 32],
    ctx: &LightCommitContext,
    memo_hash: &[u8; 32],
    proof_hash: &[u8; 32],
    alpha_hash: &[u8; 32],
    beta: &[u8; 64],
) -> ProgramResult {
    let data = build_commit_data(operator, authority_label, ctx, memo_hash, proof_hash, alpha_hash, beta);

    let [operator, light_system, cpi_authority, registered_program, compression_authority, compression_program, system_program, authority_tree, authority_queue, address_tree, output_queue] =
        accounts;

    let metas = [
        InstructionAccount::writable_signer(operator.address()),
        InstructionAccount::readonly(light_system.address()),
        InstructionAccount::readonly(cpi_authority.address()),
        InstructionAccount::readonly(registered_program.address()),
        InstructionAccount::readonly(compression_authority.address()),
        InstructionAccount::readonly(compression_program.address()),
        InstructionAccount::readonly(system_program.address()),
        InstructionAccount::writable(authority_tree.address()),
        InstructionAccount::writable(authority_queue.address()),
        InstructionAccount::writable(address_tree.address()),
        InstructionAccount::writable(output_queue.address()),
    ];

    invoke(&InstructionView { program_id: &CC_VRF_PROGRAM_ID, accounts: &metas, data: &data }, accounts)
}
