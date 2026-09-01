use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::ClaimError,
    state::{AirdropState, AIRDROP_STATE_SEED},
};

/// Replaces the Merkle root, which is only allowed before anyone has claimed.
///
/// Once a single claim has been paid out the snapshot is effectively public and
/// partly spent, so swapping the root could strand claimants who were in the
/// original tree.
///
/// Accounts:
///   0. `[writable]` airdrop state (PDA `[b"merkle_tree", mint]`)
///   1. `[]`         mint
///   2. `[signer]`   authority
///
/// Instruction data: `[new_root: [u8; 32]]`
pub fn update_tree(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [airdrop_state, mint, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let new_root: [u8; 32] = data
        .get(..32)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let (state_address, _) = Address::find_program_address(&[AIRDROP_STATE_SEED, mint.address().as_ref()], program_id);
    if airdrop_state.address() != &state_address || !airdrop_state.owned_by(program_id) {
        return Err(ClaimError::InvalidSeeds.into());
    }

    let mut state_data = airdrop_state.try_borrow_mut()?;
    let mut state = AirdropState::from_bytes(&mut state_data)?;

    if state.authority() != authority.address().as_ref() {
        return Err(ClaimError::NotAuthority.into());
    }
    if state.mint() != mint.address().as_ref() {
        return Err(ClaimError::MintMismatch.into());
    }
    if state.amount_claimed() != 0 {
        return Err(ClaimError::ClaimsStarted.into());
    }

    state.set_merkle_root(&new_root);

    log!("Merkle root updated");
    Ok(())
}
