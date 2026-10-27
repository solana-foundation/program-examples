use crate::error::EscrowError;
use {solana_program_error::ProgramError, solana_pubkey::Pubkey};

pub fn assert_is_associated_token_account(
    token_address: &Pubkey,
    owner: &Pubkey,
    mint: &Pubkey,
) -> Result<(), ProgramError> {
    let associated_token_account_address =
        &spl_associated_token_account_interface::address::get_associated_token_address(owner, mint);

    if token_address != associated_token_account_address {
        return Err(EscrowError::TokenAccountMismatch.into());
    }

    Ok(())
}
