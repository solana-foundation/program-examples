use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferHookError {
    /// The hook was invoked while the source account was not mid-transfer.
    IsNotCurrentlyTransferring = 0,
    /// The mint does not carry a `TransferHook` extension.
    MissingTransferHookExtension = 1,
    /// The `TransferHook` extension does not name the expected authority and program.
    UnexpectedTransferHookConfig = 2,
    /// The source account is not a Token-2022 account belonging to the given mint.
    InvalidSourceAccount = 3,
    /// The sender's transfer switch is off, or has never been set.
    SwitchNotOn = 4,
    /// The signer is not the configured admin.
    NotAdmin = 5,
    /// The admin config account is missing, or is not this program's PDA.
    InvalidAdminConfig = 6,
    /// The switch account is not the PDA derived for this wallet.
    InvalidSwitchAccount = 7,
    /// The proposed admin is already the admin.
    AdminUnchanged = 8,
}

impl From<TransferHookError> for ProgramError {
    fn from(error: TransferHookError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
