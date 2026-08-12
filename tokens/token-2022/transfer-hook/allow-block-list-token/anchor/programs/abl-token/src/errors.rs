use anchor_lang::error_code;

#[error_code]
pub enum ABListError {
    #[msg("Invalid metadata")]
    InvalidMetadata,

    #[msg("Wallet not allowed")]
    WalletNotAllowed,

    #[msg("Amount not allowed")]
    AmountNotAllowed,

    #[msg("Wallet blocked")]
    WalletBlocked,

    #[msg("Mint is not configured to use this transfer hook program")]
    MintNotUsingThisHook,
}
