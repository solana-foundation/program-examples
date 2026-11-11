use pinocchio::error::ProgramError;

mod create_mint;

pub use create_mint::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Its instructions are built by hand below and CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Size (in bytes) of a Token-2022 mint account that carries the
/// `InterestBearingConfig` extension.
///
/// A bare SPL mint is 82 bytes, but once any extension is present Token-2022
/// lays the account out as:
///
/// ```text
///   base account length (165, the size of a token Account) +
///   account-type byte (1)                                  +
///   TLV entry: type (2) + length (2) + value (52)          = 222
/// ```
///
/// The base is padded up to a token *Account*'s length (165) so a mint and an
/// account can never be the same size. The `InterestBearingConfig` value is 52
/// bytes: the rate authority (an optional pubkey, 32), the initialization and
/// last-update timestamps (`i64` each, 8), and the pre-update-average and
/// current rates (`i16` each, 2). This mirrors
/// `ExtensionType::try_calculate_account_len::<Mint>(&[InterestBearingConfig])`.
pub const MINT_SIZE: usize = 222;

/// Borsh-encoded arguments for the create-mint instruction: a single `u8` with
/// the mint's decimals, matching the sibling Token-2022 pinocchio examples.
pub struct CreateTokenArgs {
    pub decimals: u8,
}

impl CreateTokenArgs {
    /// Parses the instruction data: a single `u8` (the mint's decimals).
    pub fn parse(data: &[u8]) -> Result<Self, ProgramError> {
        let decimals = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
        Ok(Self { decimals })
    }
}
