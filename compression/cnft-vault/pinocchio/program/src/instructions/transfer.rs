use pinocchio::{
    cpi::{invoke_signed_with_bounds, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

use crate::instructions::{MPL_BUBBLEGUM_ID, VAULT_SEED};

/// Anchor discriminator of mpl-bubblegum's `transfer` instruction
/// (`sha256("global:transfer")[..8]`).
const TRANSFER_DISCRIMINATOR: [u8; 8] = [163, 52, 200, 231, 140, 3, 69, 186];

/// Byte length of the transfer arguments: `root`, `data_hash` and `creator_hash`
/// (32 each), `nonce` (`u64`) and `index` (`u32`).
pub const ARGS_LEN: usize = 32 + 32 + 32 + 8 + 4;

/// Number of accounts bubblegum's `Transfer` expects before the merkle proof.
const FIXED_ACCOUNTS: usize = 8;

/// Upper bound on the merkle proof passed through to bubblegum.
///
/// A proof is `max_depth - canopy_depth` nodes and SPL Account Compression
/// caps `max_depth` at 30, so no valid proof can exceed this — the bound exists
/// to keep the CPI account list on the stack rather than to impose a policy of
/// our own. A canopy-less depth-30 tree really does need all 30, and address
/// lookup tables make such a transaction fit.
pub const MAX_PROOF_ACCOUNTS: usize = 30;

/// Largest account list this program hands to bubblegum.
const MAX_CPI_ACCOUNTS: usize = FIXED_ACCOUNTS + MAX_PROOF_ACCOUNTS;

/// Accounts a single `Transfer` CPI needs.
///
/// `withdraw_two_cnfts` reuses one vault, log wrapper, compression program and
/// system program across both of its transfers, varying only the first three.
pub struct TransferAccounts<'a> {
    pub tree_authority: &'a AccountView,
    pub new_leaf_owner: &'a AccountView,
    pub merkle_tree: &'a AccountView,
    pub vault: &'a AccountView,
    pub log_wrapper: &'a AccountView,
    pub compression_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

/// Transfers one compressed NFT out of the vault by CPI'ing into mpl-bubblegum's
/// `Transfer`, with the vault PDA signing as the current leaf owner.
///
/// `args` is the 108-byte `root || data_hash || creator_hash || nonce || index`
/// blob, already in bubblegum's wire order.
pub fn transfer_cnft(accounts: TransferAccounts, proof: &[AccountView], args: &[u8], vault_bump: u8) -> ProgramResult {
    let TransferAccounts { vault, log_wrapper, compression_program, system_program, .. } = accounts;
    if args.len() != ARGS_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    if proof.len() > MAX_PROOF_ACCOUNTS {
        return Err(ProgramError::InvalidArgument);
    }

    // The tree authority is bubblegum's PDA over the merkle tree. Bubblegum
    // rederives it too, but checking here fails early with a clear error rather
    // than deep inside the CPI.
    let (expected_authority, _bump) =
        Address::find_program_address(&[accounts.merkle_tree.address().as_ref()], &MPL_BUBBLEGUM_ID);
    if accounts.tree_authority.address() != &expected_authority {
        return Err(ProgramError::InvalidSeeds);
    }

    // The transfer arguments are already in bubblegum's wire order, so the CPI
    // data is just the discriminator followed by the arguments verbatim.
    let mut data = [0u8; 8 + ARGS_LEN];
    data[..8].copy_from_slice(&TRANSFER_DISCRIMINATOR);
    data[8..].copy_from_slice(args);

    // Bubblegum's `Transfer` account order. The vault appears twice: once as the
    // leaf owner (signing the transfer) and once as the leaf delegate, which is
    // the same account here.
    let total = FIXED_ACCOUNTS + proof.len();
    let metas: [InstructionAccount; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => InstructionAccount::readonly(accounts.tree_authority.address()),
        1 => InstructionAccount::readonly_signer(vault.address()),
        2 => InstructionAccount::readonly(vault.address()),
        3 => InstructionAccount::readonly(accounts.new_leaf_owner.address()),
        4 => InstructionAccount::writable(accounts.merkle_tree.address()),
        5 => InstructionAccount::readonly(log_wrapper.address()),
        6 => InstructionAccount::readonly(compression_program.address()),
        7 => InstructionAccount::readonly(system_program.address()),
        // Entries past `total` are never read — the instruction is built from
        // `metas[..total]` — but the array still has to be fully initialized.
        _ => InstructionAccount::readonly(proof.get(i - FIXED_ACCOUNTS).unwrap_or(system_program).address()),
    });
    let account_views: [AccountView; MAX_CPI_ACCOUNTS] = core::array::from_fn(|i| match i {
        0 => *accounts.tree_authority,
        1 => *vault,
        2 => *vault,
        3 => *accounts.new_leaf_owner,
        4 => *accounts.merkle_tree,
        5 => *log_wrapper,
        6 => *compression_program,
        7 => *system_program,
        _ => *proof.get(i - FIXED_ACCOUNTS).unwrap_or(system_program),
    });

    let bump = [vault_bump];
    let seeds = [Seed::from(VAULT_SEED), Seed::from(&bump)];
    let signers = [Signer::from(&seeds)];

    invoke_signed_with_bounds::<MAX_CPI_ACCOUNTS, _>(
        &InstructionView { program_id: &MPL_BUBBLEGUM_ID, accounts: &metas[..total], data: &data },
        &account_views[..total],
        &signers,
    )
}
