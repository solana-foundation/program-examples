use pinocchio::{
    cpi::invoke_with_bounds,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

use crate::instructions::{keccak, Writer, MPL_BUBBLEGUM_ID, SPL_ACCOUNT_COMPRESSION_ID};

/// Anchor discriminator of SPL Account Compression's `verify_leaf` instruction
/// (`sha256("global:verify_leaf")[..8]`).
const VERIFY_LEAF_DISCRIMINATOR: [u8; 8] = [124, 220, 22, 223, 104, 10, 250, 224];

/// Byte length of the verify arguments: `root`, `data_hash` and `creator_hash`
/// (32 each), `nonce` (`u64`) and `index` (`u32`).
const ARGS_LEN: usize = 32 + 32 + 32 + 8 + 4;

/// `verify_leaf` takes the merkle tree, then the proof.
const FIXED_ACCOUNTS: usize = 1;

/// Upper bound on the merkle proof passed through to the compression program.
///
/// A proof is `max_depth - canopy_depth` nodes and SPL Account Compression caps
/// `max_depth` at 30, so no valid proof can exceed this — the bound exists to
/// keep the CPI account list on the stack rather than to impose a policy of our
/// own. A canopy-less depth-30 tree really does need all 30, and address lookup
/// tables make such a transaction fit.
const MAX_PROOF_ACCOUNTS: usize = 30;

/// Largest account list this instruction hands to the compression program.
const MAX_CPI_ACCOUNTS: usize = FIXED_ACCOUNTS + MAX_PROOF_ACCOUNTS;

/// Leaf schema version byte that prefixes the hash (`Version::V1`).
const LEAF_SCHEMA_V1: u8 = 1;

/// Proves that a compressed NFT belongs to a merkle tree and is owned by the
/// signer, by rebuilding its leaf hash and CPI'ing into SPL Account
/// Compression's `verify_leaf`.
///
/// Nothing is written: the instruction either succeeds, meaning the leaf really
/// is in the tree, or the CPI fails.
///
/// Accounts:
///   0. `[signer]` leaf owner
///   1. `[]`       leaf delegate
///   2. `[]`       merkle tree
///   3. `[]`       SPL Account Compression program
///   4. `[]`       merkle proof nodes (variable count)
///
/// Instruction data: `root`, `data_hash`, `creator_hash` (32 bytes each),
/// `nonce` (`u64`) and `index` (`u32`) — 108 bytes.
pub fn verify(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [leaf_owner, leaf_delegate, merkle_tree, _compression_program, proof @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if instruction_data.len() != ARGS_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    if proof.len() > MAX_PROOF_ACCOUNTS {
        return Err(ProgramError::InvalidArgument);
    }
    if !leaf_owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (root, rest) = instruction_data.split_at(32);
    let (data_hash, rest) = rest.split_at(32);
    let (creator_hash, rest) = rest.split_at(32);
    let (nonce, index) = rest.split_at(8);

    // The asset ID is bubblegum's PDA over the tree and the leaf's nonce; it is
    // what makes each leaf hash unique to one cNFT.
    let (asset_id, _bump) =
        Address::find_program_address(&[b"asset", merkle_tree.address().as_ref(), nonce], &MPL_BUBBLEGUM_ID);

    // `LeafSchema::V1::hash()` — the same preimage bubblegum hashes when it
    // writes the leaf, so a mismatch anywhere makes `verify_leaf` fail.
    let leaf = keccak(&[
        &[LEAF_SCHEMA_V1],
        asset_id.as_ref(),
        leaf_owner.address().as_ref(),
        leaf_delegate.address().as_ref(),
        nonce,
        data_hash,
        creator_hash,
    ]);

    let mut buffer = [0u8; 8 + 32 + 32 + 4];
    let mut data = Writer::new(&mut buffer);
    data.write(&VERIFY_LEAF_DISCRIMINATOR);
    data.write(root);
    data.write(&leaf);
    data.write(index);

    let total = FIXED_ACCOUNTS + proof.len();
    let metas: [InstructionAccount; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => InstructionAccount::readonly(merkle_tree.address()),
        // Entries past `total` are never read — the instruction is built from
        // `metas[..total]` — but the array still has to be fully initialized.
        _ => InstructionAccount::readonly(proof.get(i - FIXED_ACCOUNTS).unwrap_or(merkle_tree).address()),
    });
    let account_views: [AccountView; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => *merkle_tree,
        _ => *proof.get(i - FIXED_ACCOUNTS).unwrap_or(merkle_tree),
    });

    invoke_with_bounds::<MAX_CPI_ACCOUNTS, _>(
        &InstructionView { program_id: &SPL_ACCOUNT_COMPRESSION_ID, accounts: &metas[..total], data: &buffer },
        &account_views[..total],
    )
}
