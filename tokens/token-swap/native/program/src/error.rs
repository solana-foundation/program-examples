use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SwapError {
    #[error("Invalid fee value")]
    InvalidFee,

    #[error("Invalid mint for the pool")]
    InvalidMint,

    #[error("Depositing too little liquidity")]
    DepositTooSmall,

    #[error("Output is below the minimum expected")]
    OutputTooSmall,

    #[error("Invariant does not hold")]
    InvariantViolated,

    #[error("Math overflowed")]
    MathOverflow,

    #[error("Account mismatch")]
    AccountMismatch,

    #[error("Account is not authorized")]
    NotAuthorized,
}

impl From<SwapError> for ProgramError {
    fn from(e: SwapError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
