//! Gacha Solana Program.
//!
//! A provably-fair gacha (loot-box / pack-pull) game. An admin configures a pool of
//! weighted reward tiers with limited supply and a fixed entry fee, and registers an
//! off-chain VRF operator. A buyer pays the fee to open a pull, which commits a fixed
//! VRF input (`alpha`, the pull account address) before any randomness is known. The
//! operator then reveals the ECVRF output (`beta`) for that input; the program expands
//! `beta` into a weighted tier selection and records the result.
//!
//! Randomness follows the pattern shipped by Collector Crypt's [`cc-vrf`](https://vrf.collectorcrypt.com):
//! Solana cannot verify an RFC 9381 ECVRF proof on-chain, so the program trusts the
//! registered operator's signature and anyone verifies `beta = VRF(alpha)` off-chain
//! with `@collectorcrypt/ecvrf`. Fairness comes from `alpha` being fixed at commit and
//! the proof being publicly verifiable.
//!
//! Built on the [Pinocchio](https://docs.rs/pinocchio) runtime; uses
//! [Codama](https://github.com/codama-idl/codama) for IDL generation.

#![no_std]

extern crate alloc;

#[cfg(test)]
#[macro_use]
extern crate std;

use pinocchio::address::declare_id;

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
