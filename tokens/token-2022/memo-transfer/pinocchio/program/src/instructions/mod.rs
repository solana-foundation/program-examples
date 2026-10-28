mod create_token_account;

pub use create_token_account::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Unlike the legacy SPL Token program (which `pinocchio-token` wraps), there is
/// no pinocchio crate for Token-2022, so its instructions are built by hand
/// below and CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Size (in bytes) of a Token-2022 token *account* that carries the
/// `MemoTransfer` extension.
///
/// A bare SPL token account is 165 bytes, but once any extension is present
/// Token-2022 lays the account out as:
///
/// ```text
///   base account length (165)                        +
///   account-type byte (1)                            +
///   MemoTransfer TLV: type (2) + length (2) + value (1) = 171
/// ```
///
/// The `MemoTransfer` value is a single `bool` (`require_incoming_transfer_memos`),
/// so its TLV entry is the 4-byte header plus one byte. This mirrors
/// `ExtensionType::try_calculate_account_len::<Account>(&[MemoTransfer])`.
pub const ACCOUNT_SIZE: usize = 171;
