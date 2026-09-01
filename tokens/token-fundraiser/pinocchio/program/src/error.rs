use pinocchio::error::ProgramError;

/// Domain errors returned by the fundraiser program, surfaced to clients as
/// `ProgramError::Custom(code)`.
#[repr(u32)]
pub enum FundraiserError {
    /// The target amount is below the minimum allowed.
    InvalidAmount,
    /// The contribution is below the minimum allowed.
    ContributionTooSmall,
    /// The contribution exceeds the per-contributor maximum.
    ContributionTooBig,
    /// The fundraiser's duration has already elapsed.
    FundraiserEnded,
    /// This contributor has reached the per-contributor maximum.
    MaximumContributionsReached,
    /// The target amount has not been reached yet.
    TargetNotMet,
    /// The target amount has already been reached.
    TargetMet,
    /// The fundraiser's duration has not elapsed yet.
    FundraiserNotEnded,
}

impl From<FundraiserError> for ProgramError {
    fn from(error: FundraiserError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
