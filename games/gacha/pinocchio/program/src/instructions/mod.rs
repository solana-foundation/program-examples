//! Instruction definitions and dispatch for the gacha program.
//!
//! Each instruction variant carries its own discriminator (the first byte of
//! instruction data). The Codama annotations on each variant describe the required
//! accounts in positional order.

pub mod buy_pull;
pub mod emit_event;
pub mod helpers;
pub mod init_pool;
pub mod settle_pull;

pub use helpers::*;
pub use init_pool::InitPoolData;
pub use settle_pull::SettlePullData;

use core::fmt;

use codama::CodamaInstructions;
use pinocchio::error::ProgramError;

use crate::event_engine::EMIT_EVENT_IX_DISC;
use crate::GachaError;

/// All instructions supported by the gacha program.
#[derive(Debug, CodamaInstructions)]
#[repr(u8)]
#[allow(clippy::large_enum_variant)]
pub enum GachaInstruction {
    #[codama(account(name = "admin", signer, writable, docs = "Pool admin; funds and owns the pool"))]
    #[codama(account(
        name = "pool",
        writable,
        docs = "The pool PDA being created",
        default_value = pda("pool", [seed("admin", account("admin"))])
    ))]
    #[codama(account(
        name = "vault",
        writable,
        docs = "Pot vault PDA",
        default_value = pda("vault", [seed("admin", account("admin"))])
    ))]
    #[codama(account(name = "system_program", docs = "The system program", default_value = program("system")))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    InitPool(#[codama(name = "init_pool_data")] InitPoolData) = 0,

    #[codama(account(name = "buyer", signer, writable, docs = "The buyer opening and paying for a pull"))]
    #[codama(account(name = "pool", writable, docs = "The pool being pulled from"))]
    #[codama(account(name = "pull", writable, docs = "The pull PDA being created"))]
    #[codama(account(name = "vault", writable, docs = "Pot vault PDA for the pool"))]
    #[codama(account(name = "system_program", docs = "The system program", default_value = program("system")))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    BuyPull = 1,

    #[codama(account(name = "operator", signer, docs = "Registered VRF operator revealing the pull"))]
    #[codama(account(name = "pool", writable, docs = "The pool being pulled from"))]
    #[codama(account(name = "pull", writable, docs = "The pending pull being settled"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    SettlePull(#[codama(name = "settle_pull_data")] SettlePullData) = 2,

    #[codama(skip)]
    #[codama(account(name = "event_authority", signer, docs = "The event authority PDA"))]
    EmitEvent = 228,
}

impl GachaInstruction {
    /// Parse a `GachaInstruction` from raw instruction bytes.
    pub fn from_bytes(data: &[u8]) -> Result<Self, ProgramError> {
        let (discriminator, rest) = data.split_first().ok_or(GachaError::InvalidInstruction)?;

        match discriminator {
            init_pool::DISCRIMINATOR => Ok(Self::InitPool(InitPoolData::load(rest)?.clone())),
            buy_pull::DISCRIMINATOR => Ok(Self::BuyPull),
            settle_pull::DISCRIMINATOR => Ok(Self::SettlePull(SettlePullData::load(rest)?.clone())),
            &EMIT_EVENT_IX_DISC => Ok(Self::EmitEvent),
            _ => Err(GachaError::InvalidInstruction.into()),
        }
    }
}

impl fmt::Display for GachaInstruction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InitPool(_) => write!(f, "init_pool"),
            Self::BuyPull => write!(f, "buy_pull"),
            Self::SettlePull(_) => write!(f, "settle_pull"),
            Self::EmitEvent => write!(f, "emit_event"),
        }
    }
}
