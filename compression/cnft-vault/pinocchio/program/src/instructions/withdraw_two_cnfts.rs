use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{transfer_cnft, TransferAccounts, ARGS_LEN, VAULT_SEED};

/// Byte length of one cNFT's arguments: the 108-byte transfer args followed by
/// the length of its merkle proof.
const ARGS_WITH_PROOF_LEN: usize = ARGS_LEN + 1;

/// Sends two compressed NFTs — possibly from two different trees — out of the
/// vault in a single instruction.
///
/// Both proofs arrive concatenated in the account tail, so the instruction data
/// carries each proof's length to split them apart.
///
/// Accounts:
///   0. `[]`         tree authority for the first merkle tree
///   1. `[]`         vault PDA (`[b"cNFT-vault"]`, the current leaf owner)
///   2. `[]`         new leaf owner for the first cNFT
///   3. `[writable]` first merkle tree
///   4. `[]`         tree authority for the second merkle tree
///   5. `[]`         new leaf owner for the second cNFT
///   6. `[writable]` second merkle tree
///   7. `[]`         log wrapper (SPL Noop)
///   8. `[]`         SPL Account Compression program
///   9. `[]`         mpl-bubblegum program
///   10. `[]`        system program
///   11. `[]`        first proof's nodes, then the second proof's
///
/// Instruction data: the first cNFT's 108-byte transfer args and its proof
/// length (`u8`), then the same pair for the second — 218 bytes.
pub fn withdraw_two_cnfts(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let [tree_authority1, vault, new_leaf_owner1, merkle_tree1, tree_authority2, new_leaf_owner2, merkle_tree2, log_wrapper, compression_program, _bubblegum_program, system_program, proof @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if instruction_data.len() != 2 * ARGS_WITH_PROOF_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (first, second) = instruction_data.split_at(ARGS_WITH_PROOF_LEN);
    let (args1, proof1_len) = first.split_at(ARGS_LEN);
    let (args2, proof2_len) = second.split_at(ARGS_LEN);
    let proof1_len = proof1_len[0] as usize;
    let proof2_len = proof2_len[0] as usize;

    // Both lengths are checked against the accounts actually supplied, so a
    // caller cannot claim a split that reaches past the proof accounts or quietly
    // leave some of them unused.
    if proof1_len + proof2_len != proof.len() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (proof1, proof2) = proof.split_at(proof1_len);

    let (expected_vault, vault_bump) = Address::find_program_address(&[VAULT_SEED], program_id);
    if vault.address() != &expected_vault {
        return Err(ProgramError::InvalidSeeds);
    }

    log!("Sending the first compressed NFT out of the vault");
    transfer_cnft(
        TransferAccounts {
            tree_authority: tree_authority1,
            new_leaf_owner: new_leaf_owner1,
            merkle_tree: merkle_tree1,
            vault,
            log_wrapper,
            compression_program,
            system_program,
        },
        proof1,
        args1,
        vault_bump,
    )?;

    log!("Sending the second compressed NFT out of the vault");
    transfer_cnft(
        TransferAccounts {
            tree_authority: tree_authority2,
            new_leaf_owner: new_leaf_owner2,
            merkle_tree: merkle_tree2,
            vault,
            log_wrapper,
            compression_program,
            system_program,
        },
        proof2,
        args2,
        vault_bump,
    )
}
