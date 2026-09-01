use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{transfer_cnft, TransferAccounts, ARGS_LEN, VAULT_SEED};

/// Sends one compressed NFT from the vault to a new owner.
///
/// The vault PDA is the cNFT's leaf owner, so it signs the bubblegum `Transfer`.
/// It is never created as an account — naming it as the leaf owner is the whole
/// of "holding" a compressed NFT.
///
/// Accounts:
///   0. `[]`         tree authority (bubblegum PDA of the merkle tree)
///   1. `[]`         vault PDA (`[b"cNFT-vault"]`, the current leaf owner)
///   2. `[]`         new leaf owner (the recipient)
///   3. `[writable]` merkle tree
///   4. `[]`         log wrapper (SPL Noop)
///   5. `[]`         SPL Account Compression program
///   6. `[]`         mpl-bubblegum program
///   7. `[]`         system program
///   8. `[]`         merkle proof nodes (variable count)
///
/// Instruction data: `root: [u8; 32]`, `data_hash: [u8; 32]`,
/// `creator_hash: [u8; 32]`, `nonce: u64`, `index: u32` — 108 bytes, laid out
/// exactly as bubblegum's own borsh-serialized `Transfer` arguments.
pub fn withdraw_cnft(program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [tree_authority, vault, new_leaf_owner, merkle_tree, log_wrapper, compression_program, _bubblegum_program, system_program, proof @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if instruction_data.len() != ARGS_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    let (expected_vault, vault_bump) = Address::find_program_address(&[VAULT_SEED], program_id);
    if vault.address() != &expected_vault {
        return Err(ProgramError::InvalidSeeds);
    }

    log!("Sending compressed NFT out of the vault");
    transfer_cnft(
        TransferAccounts {
            tree_authority,
            new_leaf_owner,
            merkle_tree,
            vault,
            log_wrapper,
            compression_program,
            system_program,
        },
        proof,
        instruction_data,
        vault_bump,
    )
}
