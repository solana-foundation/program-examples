use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::instructions::TransferChecked;

use crate::{
    error::ClaimError,
    merkle::compute_merkle_root,
    state::{AirdropState, ClaimReceipt, AIRDROP_STATE_SEED, CLAIM_RECEIPT_SEED, CLAIM_RECEIPT_SIZE, MINT_DECIMALS},
    util::create_pda_account,
};

/// Pays out one leaf of the airdrop.
///
/// The caller proves membership by supplying the sibling hashes along the path
/// from their leaf to the root. The leaf is `signer | amount`, so a proof is
/// bound to one wallet and one amount and cannot be replayed by anyone else.
///
/// Accounts:
///   0. `[writable]`         airdrop state (PDA `[b"merkle_tree", mint]`)
///   1. `[]`                 mint
///   2. `[writable]`         vault (the airdrop state's associated token account)
///   3. `[writable]`         claim receipt (PDA `[b"claim_receipt", airdrop_state, index]`)
///   4. `[writable]`         claimer's associated token account
///   5. `[signer, writable]` claimer
///   6. `[]`                 system program
///   7. `[]`                 SPL Token program
///   8. `[]`                 associated token program
///
/// Instruction data: `[amount: u64 (LE), index: u64 (LE), hashes: [u8; 32 * depth]]`
pub fn claim_airdrop(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [airdrop_state, mint, vault, claim_receipt, signer_ata, signer, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let index = u64::from_le_bytes(
        data.get(8..16)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let hashes = data.get(16..).ok_or(ProgramError::InvalidInstructionData)?;

    if amount == 0 {
        return Err(ClaimError::InvalidAmount.into());
    }

    let (state_address, state_bump) =
        Address::find_program_address(&[AIRDROP_STATE_SEED, mint.address().as_ref()], program_id);
    if airdrop_state.address() != &state_address || !airdrop_state.owned_by(program_id) {
        return Err(ClaimError::InvalidSeeds.into());
    }

    // The leaf commits to who is claiming and how much, so a proof lifted from
    // someone else's claim will not reproduce the root.
    let mut leaf = [0u8; 40];
    leaf[..32].copy_from_slice(signer.address().as_ref());
    leaf[32..].copy_from_slice(&amount.to_le_bytes());

    let (receipt_address, receipt_bump) = Address::find_program_address(
        &[CLAIM_RECEIPT_SEED, airdrop_state.address().as_ref(), &index.to_le_bytes()],
        program_id,
    );
    if claim_receipt.address() != &receipt_address {
        return Err(ClaimError::InvalidSeeds.into());
    }

    // A receipt already holding a claimer means this index has been paid.
    if !claim_receipt.is_data_empty() {
        if !claim_receipt.owned_by(program_id) || claim_receipt.data_len() != CLAIM_RECEIPT_SIZE {
            return Err(ClaimError::InvalidAccountData.into());
        }
        if ClaimReceipt::from_bytes(&mut claim_receipt.try_borrow_mut()?)?.is_claimed() {
            return Err(ClaimError::AlreadyClaimed.into());
        }
    }

    let new_amount_claimed = {
        let mut state_data = airdrop_state.try_borrow_mut()?;
        let state = AirdropState::from_bytes(&mut state_data)?;

        if state.mint() != mint.address().as_ref() {
            return Err(ClaimError::MintMismatch.into());
        }

        let computed_root = compute_merkle_root(&leaf, hashes, index)?;
        if computed_root != state.merkle_root() {
            return Err(ClaimError::InvalidProof.into());
        }

        let new_amount_claimed = state.amount_claimed().checked_add(amount).ok_or(ClaimError::AmountOverflow)?;
        if new_amount_claimed > state.airdrop_amount() {
            return Err(ClaimError::ClaimExceedsAirdrop.into());
        }
        new_amount_claimed
    };

    // Create the receipt only once the proof has been checked, so a bad proof
    // costs the caller nothing and leaves no account behind.
    if claim_receipt.is_data_empty() {
        let receipt_bump_bytes = [receipt_bump];
        let index_bytes = index.to_le_bytes();
        let receipt_seeds = [
            Seed::from(CLAIM_RECEIPT_SEED),
            Seed::from(airdrop_state.address().as_ref()),
            Seed::from(&index_bytes),
            Seed::from(&receipt_bump_bytes),
        ];

        create_pda_account(signer, claim_receipt, CLAIM_RECEIPT_SIZE, program_id, &receipt_seeds)?;
    }

    CreateIdempotent {
        funding_account: signer,
        account: signer_ata,
        wallet: signer,
        mint,
        system_program,
        token_program,
    }
    .invoke()?;

    let state_bump_bytes = [state_bump];
    let state_seeds =
        [Seed::from(AIRDROP_STATE_SEED), Seed::from(mint.address().as_ref()), Seed::from(&state_bump_bytes)];

    TransferChecked::<&AccountView> {
        from: vault,
        mint,
        to: signer_ata,
        authority: airdrop_state,
        amount,
        decimals: MINT_DECIMALS,
        multisig_signers: &[],
    }
    .invoke_signed(&[Signer::from(&state_seeds)])?;

    ClaimReceipt::from_bytes(&mut claim_receipt.try_borrow_mut()?)?.write(
        airdrop_state.address(),
        signer.address(),
        index,
        amount,
        receipt_bump,
    );

    AirdropState::from_bytes(&mut airdrop_state.try_borrow_mut()?)?.set_amount_claimed(new_amount_claimed);

    log!("Claim paid");
    Ok(())
}
