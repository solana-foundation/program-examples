//! On-chain account state types for the gacha program.
//!
//! Each data-carrying account is stored as a packed C struct in a Program Derived
//! Account (PDA), with a one-byte discriminator at offset 0. The pot [`Vault`] is a
//! zero-data PDA; the [`PrizeMint`] is a Token-2022 mint owned by the token program.

pub mod common;
pub mod pool;
pub mod prize_mint;
pub mod pull;
pub mod vault;

pub use common::{
    find_mint_pda, find_pool_pda, find_pull_pda, find_vault_pda, AccountDiscriminator, PullStatus, MINT_SEED,
    POOL_SEED, PULL_SEED, VAULT_SEED,
};
pub use pool::Pool;
pub use prize_mint::PrizeMint;
pub use pull::{Pull, TIER_UNSET};
pub use vault::Vault;
