mod create_associated_token_account;
mod create_token;
mod create_token_account;
mod mint_token;
mod transfer_token;

pub use create_associated_token_account::*;
pub use create_token::*;
pub use create_token_account::*;
pub use mint_token::*;
pub use transfer_token::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// There is no pinocchio crate for Token-2022 (only for the legacy SPL Token
/// program), so its instructions are built by hand and CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// PDA seed prefixes matching the anchor example.
pub const TOKEN_SEED: &[u8] = b"token-2022-token";
pub const TOKEN_ACCOUNT_SEED: &[u8] = b"token-2022-token-account";

/// The mint is created with 6 decimals. The same value is needed on the client
/// side of `TransferChecked`, which re-verifies the decimals.
pub const MINT_DECIMALS: u8 = 6;

/// Size of a Token-2022 mint with no extensions — identical to a legacy SPL
/// mint (82 bytes).
pub const MINT_SIZE: usize = 82;

/// Size of a Token-2022 token account with no extensions — identical to a legacy
/// SPL token account (165 bytes).
pub const ACCOUNT_SIZE: usize = 165;

/// Parses a little-endian `u64` amount from the front of an instruction's data.
pub fn parse_u64(data: &[u8]) -> Result<u64, pinocchio::error::ProgramError> {
    data.get(..8)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
        .ok_or(pinocchio::error::ProgramError::InvalidInstructionData)
}
