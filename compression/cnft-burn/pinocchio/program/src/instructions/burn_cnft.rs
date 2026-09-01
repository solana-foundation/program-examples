use pinocchio::{
    cpi::invoke_with_bounds,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;

use crate::instructions::MPL_BUBBLEGUM_ID;

/// Anchor discriminator of mpl-bubblegum's `burn` instruction
/// (`sha256("global:burn")[..8]`).
const BURN_DISCRIMINATOR: [u8; 8] = [116, 110, 29, 56, 107, 219, 42, 93];

/// Byte length of the burn arguments: `root`, `data_hash` and `creator_hash`
/// (32 each), `nonce` (`u64`) and `index` (`u32`).
const ARGS_LEN: usize = 32 + 32 + 32 + 8 + 4;

/// Number of accounts bubblegum's `Burn` expects before the merkle proof.
const FIXED_ACCOUNTS: usize = 7;

/// Upper bound on the merkle proof passed through to bubblegum.
///
/// A proof is `max_depth - canopy_depth` nodes and SPL Account Compression
/// caps `max_depth` at 30, so no valid proof can exceed this — the bound exists
/// to keep the CPI account list on the stack rather than to impose a policy of
/// our own. A canopy-less depth-30 tree really does need all 30, and address
/// lookup tables make such a transaction fit.
const MAX_PROOF_ACCOUNTS: usize = 30;

/// Largest account list this program hands to bubblegum.
const MAX_CPI_ACCOUNTS: usize = FIXED_ACCOUNTS + MAX_PROOF_ACCOUNTS;

/// Burns a compressed NFT by CPI'ing into mpl-bubblegum's `Burn`.
///
/// A compressed NFT is a leaf in a concurrent merkle tree, so "burning" it means
/// replacing that leaf with an empty node. Bubblegum needs the current tree
/// `root`, the leaf's `data_hash`/`creator_hash`, its `nonce` and `index`, plus
/// the merkle proof — all of which the client reads from a DAS indexer (see
/// `tests/test.ts` for the values computed locally).
///
/// Accounts:
///   0. `[signer, writable]` leaf owner (the cNFT holder; also the delegate)
///   1. `[]`                 tree authority (bubblegum PDA of the merkle tree)
///   2. `[writable]`         merkle tree
///   3. `[]`                 log wrapper (SPL Noop)
///   4. `[]`                 SPL Account Compression program
///   5. `[]`                 mpl-bubblegum program
///   6. `[]`                 system program
///   7. `[]`                 merkle proof nodes (variable count)
///
/// Instruction data: `root: [u8; 32]`, `data_hash: [u8; 32]`,
/// `creator_hash: [u8; 32]`, `nonce: u64`, `index: u32` — 108 bytes, laid out
/// exactly as bubblegum's own borsh-serialized `Burn` arguments.
pub fn burn_cnft(accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [leaf_owner, tree_authority, merkle_tree, log_wrapper, compression_program, _bubblegum_program, system_program, proof @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if instruction_data.len() != ARGS_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    if proof.len() > MAX_PROOF_ACCOUNTS {
        return Err(ProgramError::InvalidArgument);
    }

    // The tree authority is bubblegum's PDA over the merkle tree. Bubblegum
    // rederives it too, but checking here fails early with a clear error rather
    // than deep inside the CPI.
    let (expected_authority, _bump) =
        Address::find_program_address(&[merkle_tree.address().as_ref()], &MPL_BUBBLEGUM_ID);
    if tree_authority.address() != &expected_authority {
        return Err(ProgramError::InvalidSeeds);
    }

    // The burn arguments are already in bubblegum's wire order, so the CPI data
    // is just the discriminator followed by the instruction data verbatim.
    let mut data = [0u8; 8 + ARGS_LEN];
    data[..8].copy_from_slice(&BURN_DISCRIMINATOR);
    data[8..].copy_from_slice(instruction_data);

    // Bubblegum's `Burn` account order. The leaf owner appears twice: once as
    // the owner (signing the burn) and once as the delegate, which is the same
    // account here.
    let total = FIXED_ACCOUNTS + proof.len();
    let metas: [InstructionAccount; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => InstructionAccount::readonly(tree_authority.address()),
        1 => InstructionAccount::readonly_signer(leaf_owner.address()),
        2 => InstructionAccount::readonly(leaf_owner.address()),
        3 => InstructionAccount::writable(merkle_tree.address()),
        4 => InstructionAccount::readonly(log_wrapper.address()),
        5 => InstructionAccount::readonly(compression_program.address()),
        6 => InstructionAccount::readonly(system_program.address()),
        // Entries past `total` are never read — the instruction is built from
        // `metas[..total]` — but the array still has to be fully initialized.
        _ => InstructionAccount::readonly(proof.get(i - FIXED_ACCOUNTS).unwrap_or(system_program).address()),
    });
    let account_views: [AccountView; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => *tree_authority,
        1 => *leaf_owner,
        2 => *leaf_owner,
        3 => *merkle_tree,
        4 => *log_wrapper,
        5 => *compression_program,
        6 => *system_program,
        _ => *proof.get(i - FIXED_ACCOUNTS).unwrap_or(system_program),
    });

    log!("Burning compressed NFT");
    invoke_with_bounds::<MAX_CPI_ACCOUNTS, _>(
        &InstructionView { program_id: &MPL_BUBBLEGUM_ID, accounts: &metas[..total], data: &data },
        &account_views[..total],
    )?;

    log!("Compressed NFT burned");
    Ok(())
}
