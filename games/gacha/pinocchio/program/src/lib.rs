//! Gacha Solana Program.
//!
//! A provably-fair gacha (loot-box / pack-pull) game. An admin configures a pool of
//! fixed-weight reward tiers and a fixed entry fee, and registers an off-chain VRF
//! operator (a frozen [`cc-vrf`](https://vrf.collectorcrypt.com) authority). A buyer
//! pays the fee to open a pull, committing a VRF input
//! `alpha = SHA-256(pull_address || client_seed)` — buyer entropy the operator cannot
//! predict. The operator reveals the ECVRF output (`beta`): `settle_pull` anchors the
//! proof in the cc-vrf registry via CPI (one commit per pull, enforced by Light
//! Protocol address uniqueness) and expands `beta` into a weighted tier. `claim_prize`
//! then mints the prize — a Token-2022 NFT whose metadata carries the tier's rarity.
//! Unsettled pulls are refundable after a deadline; the admin can withdraw only
//! settled fees.
//!
//! Solana cannot verify an RFC 9381 ECVRF proof on-chain, so on-chain the program
//! trusts the registered operator's signature; anyone verifies `beta = VRF(alpha)`
//! off-chain with `@collectorcrypt/ecvrf` — cheating is detectable, and the registry
//! commit makes the evidence canonical.
//!
//! Built on the [Pinocchio](https://docs.rs/pinocchio) runtime; uses
//! [Codama](https://github.com/codama-idl/codama) for IDL generation.

#![no_std]

extern crate alloc;

#[cfg(test)]
#[macro_use]
extern crate std;

use pinocchio::address::declare_id;

pub mod ccvrf;

pub mod errors;
pub use errors::*;

pub mod event_engine;
pub mod events;

pub mod gacha;
pub use gacha::*;

pub mod instructions;
pub use instructions::*;

pub mod state;
pub use state::*;

#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;

#[cfg(test)]
mod tests;

declare_id!("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS");

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Gacha Program",
    project_url: "https://github.com/solana-foundation/program-examples",
    contacts: "link:https://github.com/solana-foundation/program-examples/security/advisories/new",
    policy: "https://github.com/solana-foundation/program-examples/security/policy",
    source_code: "https://github.com/solana-foundation/program-examples"
}
