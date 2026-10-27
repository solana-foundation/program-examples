use solana_program_error::ProgramError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EscrowError {
    #[error("Offer key provided does not match expected")]
    OfferKeyMismatch,

    #[error("Token account provided does not match expected")]
    TokenAccountMismatch,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
