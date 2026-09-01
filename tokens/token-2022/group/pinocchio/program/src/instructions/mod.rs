mod initialize_group;

pub use initialize_group::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Unlike the legacy SPL Token program (which `pinocchio-token` wraps), there is
/// no pinocchio crate for Token-2022, so its instructions are built by hand and
/// CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Seed for the group mint PDA. The mint is derived from a single static seed so
/// the client can address it without passing it in.
pub const GROUP_MINT_SEED: &[u8] = b"group";

/// Decimals for the group mint (matches the anchor example).
pub const MINT_DECIMALS: u8 = 2;

/// Size (in bytes) of a Token-2022 mint account that carries the `GroupPointer`
/// extension.
///
/// A bare SPL mint is 82 bytes, but once any extension is present Token-2022
/// lays the account out as:
///
/// ```text
///   base account length (165)                     +
///   account-type byte (1)                         +
///   TLV entry: type (2) + length (2) + value (64) = 234
/// ```
///
/// The `GroupPointer` value is two pubkeys (authority + group_address), 64 bytes.
/// This mirrors `ExtensionType::try_calculate_account_len::<Mint>(&[GroupPointer])`.
pub const MINT_SIZE: usize = 234;
