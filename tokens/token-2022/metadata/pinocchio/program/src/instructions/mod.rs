mod create_mint;

pub use create_mint::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Unlike the legacy SPL Token program (which `pinocchio-token` wraps), there is
/// no pinocchio crate for Token-2022, so its instructions are built by hand
/// below and CPI'd into this program. Token-2022 also implements the SPL Token
/// Metadata interface, so the metadata instruction is CPI'd into this same
/// program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Initial size (in bytes) of the mint account, sized for the base mint plus the
/// fixed-length `MetadataPointer` extension only.
///
/// ```text
///   base account length (165, the size of a token Account) +
///   account-type byte (1)                                  +
///   MetadataPointer TLV: type (2) + length (2) + value (64) = 234
/// ```
///
/// The `MetadataPointer` value is two optional pubkeys (authority + metadata
/// address, 32 bytes each). The variable-length `TokenMetadata` extension is not
/// counted here: it is added afterwards by `TokenMetadataInitialize`, which
/// reallocates the account to fit (see `create_mint`).
pub const MINT_SIZE_WITH_POINTER: usize = 234;

/// The mint's decimals. Matches the anchor example; metadata mints are commonly
/// created with a small, fixed number of decimals.
pub const MINT_DECIMALS: u8 = 2;
