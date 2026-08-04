//! Program IDs the tests build instruction metas from, each taken from the crate
//! that owns it. cc-vrf and Light addresses come straight from
//! [`crate::ccvrf`](gacha::ccvrf).

use solana_address::Address;

/// The gacha program, as the generated client declares it — so a program-ID
/// mismatch between the program and its client fails the whole suite.
pub const PROGRAM_ID: Address = gacha_client::GACHA_ID;

pub const SYSTEM_PROGRAM_ID: Address = pinocchio_system::ID;
pub const TOKEN_2022_ID: Address = pinocchio_token_2022::ID;
pub const ATA_PROGRAM_ID: Address = pinocchio_associated_token_account::ID;
