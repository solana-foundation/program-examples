use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwapError {
    /// The fee is not below 100%.
    InvalidFee = 0,
    /// A mint does not match the one the pool was created for.
    InvalidMint = 1,
    /// The first deposit must exceed the locked minimum liquidity.
    DepositTooSmall = 2,
    /// The trade would return less than the caller asked for.
    OutputTooSmall = 3,
    /// The constant-product invariant would fall.
    InvariantViolated = 4,
    /// An arithmetic step overflowed or divided by zero.
    MathOverflow = 5,
    /// An account is not the PDA this program derives for it.
    InvalidSeeds = 6,
    /// An account is not owned by this program, or is the wrong size.
    InvalidAccountData = 7,
}

impl From<SwapError> for ProgramError {
    fn from(error: SwapError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
