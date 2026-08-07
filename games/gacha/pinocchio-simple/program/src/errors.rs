use codama::CodamaErrors;
use pinocchio::error::ProgramError;
use thiserror::Error;

impl From<GachaError> for ProgramError {
    fn from(e: GachaError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

#[cfg(test)]
impl TryFrom<u32> for GachaError {
    type Error = u32;

    fn try_from(code: u32) -> Result<Self, Self::Error> {
        match code {
            100 => Ok(Self::NotSigner),
            101 => Ok(Self::AccountNotWritable),
            102 => Ok(Self::NotSystemProgram),
            103 => Ok(Self::NotEnoughAccountKeys),
            104 => Ok(Self::InvalidInstruction),
            105 => Ok(Self::InvalidAccountData),
            106 => Ok(Self::InvalidAccountDiscriminator),
            107 => Ok(Self::ArithmeticOverflow),
            108 => Ok(Self::NotProgramOwned),
            109 => Ok(Self::NotTokenProgram),
            110 => Ok(Self::NotAtaProgram),
            200 => Ok(Self::InvalidPoolPda),
            201 => Ok(Self::PoolAlreadyExists),
            202 => Ok(Self::Unauthorized),
            203 => Ok(Self::InvalidTierConfig),
            204 => Ok(Self::TooManyTiers),
            205 => Ok(Self::InvalidEntryFee),
            206 => Ok(Self::InvalidOperator),
            207 => Ok(Self::InvalidSettleDeadline),
            300 => Ok(Self::InvalidPullPda),
            301 => Ok(Self::PullAlreadyExists),
            303 => Ok(Self::PoolMismatch),
            304 => Ok(Self::RefundTooEarly),
            305 => Ok(Self::BuyerMismatch),
            400 => Ok(Self::NotOperator),
            401 => Ok(Self::InvalidMintPda),
            500 => Ok(Self::InvalidVaultPda),
            501 => Ok(Self::InsufficientVaultFunds),
            600 => Ok(Self::InvalidEventAuthority),
            601 => Ok(Self::InvalidEventData),
            _ => Err(code),
        }
    }
}

/// Program-specific error codes for the gacha program.
///
/// - **100--199**: Generic account and data validation errors.
/// - **200--299**: Pool configuration errors.
/// - **300--399**: Pull (commit / refund) errors.
/// - **400--499**: Settle (reveal) errors.
/// - **500--599**: Vault errors.
/// - **600--699**: Event emission errors.
#[derive(Debug, Copy, Clone, Error, CodamaErrors)]
pub enum GachaError {
    // --- Generic errors (100--199) ---
    #[error("Account must be a signer")]
    NotSigner = 100,
    #[error("Account must be writable")]
    AccountNotWritable,
    #[error("Expected system program")]
    NotSystemProgram,
    #[error("Not enough account keys provided")]
    NotEnoughAccountKeys,
    #[error("Invalid instruction")]
    InvalidInstruction,
    #[error("Invalid account data")]
    InvalidAccountData,
    #[error("Invalid account discriminator")]
    InvalidAccountDiscriminator,
    #[error("Arithmetic overflow")]
    ArithmeticOverflow,
    #[error("Account is not owned by this program")]
    NotProgramOwned,
    #[error("Expected the Token-2022 program")]
    NotTokenProgram,
    #[error("Expected the associated token account program")]
    NotAtaProgram,

    // --- Pool errors (200--299) ---
    #[error("Invalid pool PDA derivation")]
    InvalidPoolPda = 200,
    #[error("Pool account already exists")]
    PoolAlreadyExists,
    #[error("Signer is not the pool admin")]
    Unauthorized,
    #[error("Tier configuration is invalid (zero weight)")]
    InvalidTierConfig,
    #[error("Tier count is zero or exceeds the maximum")]
    TooManyTiers,
    #[error("Entry fee must be nonzero")]
    InvalidEntryFee,
    #[error("Operator must be a nonzero, on-curve key distinct from the admin")]
    InvalidOperator,
    #[error("Settle deadline must be nonzero")]
    InvalidSettleDeadline,

    // --- Pull errors (300--399) ---
    #[error("Invalid pull PDA derivation")]
    InvalidPullPda = 300,
    #[error("Pull already exists for this index")]
    PullAlreadyExists = 301,
    #[error("Pull does not belong to the provided pool")]
    PoolMismatch = 303,
    #[error("Settle deadline has not passed yet")]
    RefundTooEarly = 304,
    #[error("Account is not the pull's buyer")]
    BuyerMismatch = 305,

    // --- Settle errors (400--499) ---
    #[error("Signer is not the registered pool operator")]
    NotOperator = 400,
    #[error("Invalid prize mint PDA derivation")]
    InvalidMintPda = 401,

    // --- Vault errors (500--599) ---
    #[error("Invalid vault PDA derivation")]
    InvalidVaultPda = 500,
    #[error("Withdrawal exceeds the vault balance net of pending-pull liabilities")]
    InsufficientVaultFunds,

    // --- Event errors (600--699) ---
    #[error("Invalid event authority PDA")]
    InvalidEventAuthority = 600,
    #[error("Invalid event data")]
    InvalidEventData,
}
