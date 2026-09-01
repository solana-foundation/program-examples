mod authority_transfer;
mod initialize;
mod set_ethereum_address;
mod transfer_tokens;

pub use authority_transfer::*;
pub use initialize::*;
pub use set_ethereum_address::*;
pub use transfer_tokens::*;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::error::DelegateError;

/// Moves tokens out of the user's token account, signing as the PDA that owns it.
///
/// Shared by the two transfer instructions: they differ only in what authorises
/// the move — an Ethereum signature or the Solana authority — not in how the
/// tokens travel.
pub fn transfer_from_user_pda(
    program_id: &Address,
    user_account: &AccountView,
    user_pda: &AccountView,
    user_token_account: &AccountView,
    recipient_token_account: &AccountView,
    amount: u64,
) -> ProgramResult {
    let (expected_pda, bump) = Address::find_program_address(&[user_account.address().as_ref()], program_id);
    if user_pda.address() != &expected_pda {
        return Err(DelegateError::InvalidUserPda.into());
    }

    let bump_bytes = [bump];
    let seeds = [Seed::from(user_account.address().as_ref()), Seed::from(&bump_bytes)];

    Transfer::<&AccountView> {
        from: user_token_account,
        to: recipient_token_account,
        authority: user_pda,
        amount,
        multisig_signers: &[],
    }
    .invoke_signed(&[Signer::from(&seeds)])
}

/// Reads the caller's authority out of `user_account` and checks it signed.
pub fn check_authority(program_id: &Address, user_account: &AccountView, authority: &AccountView) -> ProgramResult {
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !user_account.owned_by(program_id) {
        return Err(DelegateError::InvalidAccountData.into());
    }

    let data = user_account.try_borrow()?;
    let stored = data.get(..32).ok_or(DelegateError::InvalidAccountData)?;
    if stored != authority.address().as_ref() {
        return Err(DelegateError::NotAuthority.into());
    }

    Ok(())
}
