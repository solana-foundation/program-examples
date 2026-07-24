//! On-chain account state types for the gacha program.
//!
//! Each data-carrying account is stored as a packed C struct in a Program Derived
//! Account (PDA), with a one-byte discriminator at offset 0. The pot [`Vault`] is a
//! zero-data PDA.

pub mod common;
pub mod pool;
pub mod pull;
pub mod vault;

pub use common::{
    find_pool_pda, find_pull_pda, find_vault_pda, AccountDiscriminator, PullStatus, POOL_SEED, PULL_SEED, VAULT_SEED,
};
pub use pool::Pool;
pub use pull::{Pull, TIER_UNSET};
pub use vault::Vault;
