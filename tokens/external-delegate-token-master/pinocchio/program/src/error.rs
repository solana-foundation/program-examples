use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DelegateError {
    /// The signature does not recover to the account's Ethereum address.
    InvalidSignature = 0,
    /// The nonce would exceed `u64::MAX`.
    NonceOverflow = 1,
    /// The signer is not the account's authority.
    NotAuthority = 2,
    /// The account is not owned by this program, or is the wrong size.
    InvalidAccountData = 3,
    /// The token authority account is not the PDA derived for this user account.
    InvalidUserPda = 4,
    /// No Ethereum address has been set on this account yet.
    EthereumAddressUnset = 5,
}

impl From<DelegateError> for ProgramError {
    fn from(error: DelegateError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
