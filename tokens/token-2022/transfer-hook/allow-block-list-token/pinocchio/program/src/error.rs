use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AblError {
    /// One of the wallets in the transfer is explicitly blocked.
    WalletBlocked = 0,
    /// The mint is in `Allow` mode and the receiver is not on the list.
    WalletNotAllowed = 1,
    /// The transfer is at or above the mixed-mode threshold and the receiver is
    /// not on the list.
    AmountNotAllowed = 2,
    /// The mint's metadata does not parse, or holds an unknown mode.
    InvalidMetadata = 3,
    /// The mode byte in the instruction data is not 0, 1 or 2.
    InvalidMode = 4,
    /// The mint does not name this program as its transfer hook.
    MintNotUsingThisHook = 5,
    /// An account is not the PDA this program derives for it.
    InvalidSeeds = 6,
    /// An account is not owned by this program, or is the wrong size.
    InvalidAccountData = 7,
    /// The signer is not the config's authority.
    NotAuthority = 8,
    /// The source account is not a Token-2022 account belonging to the mint.
    InvalidSourceAccount = 9,
    /// The hook was invoked while the source account was not mid-transfer.
    IsNotCurrentlyTransferring = 10,
}

impl From<AblError> for ProgramError {
    fn from(error: AblError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
