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
}

impl From<TransferHookError> for ProgramError {
    fn from(error: TransferHookError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
