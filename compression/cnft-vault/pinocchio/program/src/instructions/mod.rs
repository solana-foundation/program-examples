mod transfer;
mod withdraw_cnft;
mod withdraw_two_cnfts;

pub use transfer::*;
pub use withdraw_cnft::*;
pub use withdraw_two_cnfts::*;

/// The mpl-bubblegum program ID
/// (`BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`).
///
/// There is no pinocchio crate for bubblegum, so its `Transfer` instruction is
/// built by hand in `transfer` and CPI'd into this constant — never into a
/// caller-supplied program account.
pub const MPL_BUBBLEGUM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");

/// Seed of the vault PDA that holds the compressed NFTs.
///
/// The PDA is never created as an account — it only ever exists as a signer, so
/// the cNFTs are "held" by naming it as their leaf owner.
pub const VAULT_SEED: &[u8] = b"cNFT-vault";
