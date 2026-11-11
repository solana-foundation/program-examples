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
/// `TransferFeeConfig` extension.
///
/// A bare SPL mint is 82 bytes, but once any extension is present Token-2022
/// lays the account out as:
///
/// ```text
///   base account length (165, the size of a token Account) +
///   account-type byte (1)                                  +
///   TLV entry: type (2) + length (2) + value (108)         = 278
/// ```
///
/// The base is padded up to a token *Account*'s length (165) so a mint and an
/// account can never be the same size. The `TransferFeeConfig` value is 108
/// bytes: two optional-pubkey authorities (32 each), a withheld-amount `u64`
/// (8), and the older/newer `TransferFee`s (18 each: `epoch` u64, `maximum_fee`
/// u64, `transfer_fee_basis_points` u16). This mirrors
/// `ExtensionType::try_calculate_account_len::<Mint>(&[TransferFeeConfig])`.
pub const MINT_SIZE: usize = 278;

/// Borsh-encoded arguments for the create-mint instruction.
///
/// Field order matches the `native` example's `CreateTokenArgs` so the two
/// options share an identical wire format.
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
