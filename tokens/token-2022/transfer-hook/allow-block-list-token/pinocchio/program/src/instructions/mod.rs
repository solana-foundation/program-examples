mod config;
mod mint;
mod tx_hook;

pub use config::*;
pub use mint::*;
pub use tx_hook::*;

use pinocchio::{AccountView, Address};

use crate::error::AblError;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
pub const TOKEN_2022_PROGRAM_ID: Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// A serialized `ExtraAccountMetaList` naming the two allow/block records this
/// hook needs — one for each side of the transfer.
///
/// ```text
///   [105, 37, 101, 197, 75, 251, 102, 26]  Execute discriminator
///   [74, 0, 0, 0]                          value length (u32) = 4 + 2 * 35
///   [2, 0, 0, 0]                           account count (u32) = 2
///   ---- two 35-byte ExtraAccountMetas ----
///   [1]                                    a PDA of this program
///   [1, 9, b"ab_wallet", 4, 0, 32, 32, ..] seed config, padded to 32 bytes
///   [0] [0]                                is_signer, is_writable
///   [1]
///   [1, 9, b"ab_wallet", 4, 2, 32, 32, ..]
///   [0] [0]
/// ```
///
/// Each seed config is `Seed::Literal(b"ab_wallet")` followed by
/// `Seed::AccountData { account_index, data_index: 32, length: 32 }` — 32 bytes
/// at offset 32 of a token account is its owner. Account 0 of the `Execute`
/// call is the source token account and account 2 the destination, so
/// Token-2022 derives both wallets' records itself and no caller names them.
#[rustfmt::skip]
pub const EXTRA_ACCOUNT_METAS_DATA: [u8; 86] = [
    105, 37, 101, 197, 75, 251, 102, 26,
    74, 0, 0, 0,
    2, 0, 0, 0,
    // source wallet's record
    1,
    1, 9, b'a', b'b', b'_', b'w', b'a', b'l', b'l', b'e', b't',
    4, 0, 32, 32,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    0,
    // destination wallet's record
    1,
    1, 9, b'a', b'b', b'_', b'w', b'a', b'l', b'l', b'e', b't',
    4, 2, 32, 32,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    0,
];

/// Confirms `account` is the PDA for `seeds`, returning its bump.
pub fn expect_pda(
    program_id: &Address,
    account: &AccountView,
    seeds: &[&[u8]],
) -> Result<u8, pinocchio::error::ProgramError> {
    let (address, bump) = Address::find_program_address(seeds, program_id);
    if account.address() != &address {
        return Err(AblError::InvalidSeeds.into());
    }
    Ok(bump)
}
