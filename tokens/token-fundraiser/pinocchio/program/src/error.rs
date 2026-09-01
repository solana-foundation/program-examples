use pinocchio::error::ProgramError;

/// Program-specific failures, surfaced to clients as `ProgramError::Custom(n)`
/// where `n` is the variant's discriminant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FundraiserError {
    /// The campaign target has not been reached yet.
    TargetNotMet,
    /// The campaign target was reached, so contributions cannot be refunded.
    TargetMet,
    /// The contribution exceeds the per-contributor cap.
    ContributionTooBig,
    /// The contribution is below the minimum contribution.
    ContributionTooSmall,
    /// This contributor has already supplied their maximum share.
    MaximumContributionsReached,
    /// The campaign is still running.
    FundraiserNotEnded,
    /// The campaign has already ended.
    FundraiserEnded,
    /// The campaign target is below the minimum allowed target.
    InvalidAmount,
    /// A supplied account is not the account the program derived.
    InvalidAccount,
    /// An arithmetic operation overflowed.
    ArithmeticOverflow,
}

impl From<FundraiserError> for ProgramError {
    fn from(e: FundraiserError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
