//! Address derivations the generated client does not cover.
//!
//! Pool, vault, pull, prize-mint, and event-authority PDAs are derived through
//! `gacha_client`'s `find_pda` helpers, so the tests exercise the seeds the IDL
//! declares rather than a second copy of them.

use solana_address::Address;

use crate::tests::constants::{ATA_PROGRAM_ID, TOKEN_2022_ID};

/// Derives the wallet's Token-2022 associated token account for a mint.
pub fn get_ata(wallet: &Address, mint: &Address) -> Address {
    Address::find_program_address(&[wallet.as_ref(), TOKEN_2022_ID.as_ref(), mint.as_ref()], &ATA_PROGRAM_ID).0
}
