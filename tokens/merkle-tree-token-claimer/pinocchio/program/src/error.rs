use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimError {
    /// The Merkle proof does not reproduce the recorded root.
    InvalidProof = 0,
    /// A receipt already exists for this index.
    AlreadyClaimed = 1,
    /// The running claimed total would overflow.
    AmountOverflow = 2,
    /// This claim would take more than the airdrop holds.
    ClaimExceedsAirdrop = 3,
    /// The tree can only be replaced before the first claim.
    ClaimsStarted = 4,
    /// The claim amount is zero.
    InvalidAmount = 5,
    /// An account is not the PDA this program derives for it.
    InvalidSeeds = 6,
    /// An account is not owned by this program, or is the wrong size.
    InvalidAccountData = 7,
    /// The signer is not the airdrop's authority.
    NotAuthority = 8,
    /// The mint does not match the one the airdrop was created for.
    MintMismatch = 9,
}

impl From<ClaimError> for ProgramError {
    fn from(error: ClaimError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
