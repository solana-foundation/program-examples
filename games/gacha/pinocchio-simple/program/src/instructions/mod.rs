//! Instruction definitions and dispatch for the gacha-simple program.
//!
//! Each instruction variant carries its own discriminator (the first byte of
//! instruction data). The Codama annotations on each variant describe the required
//! accounts in positional order.

pub mod buy_pull;
pub mod emit_event;
pub mod helpers;
pub mod init_pool;
pub mod refund_pull;
pub mod settle_and_distribute;
pub mod withdraw_fees;

pub use buy_pull::BuyPullData;
pub use helpers::*;
pub use init_pool::InitPoolData;
pub use settle_and_distribute::SettleAndDistributeData;
pub use withdraw_fees::WithdrawFeesData;

use core::fmt;

use codama::CodamaInstructions;
use pinocchio::error::ProgramError;

use crate::event_engine::EMIT_EVENT_IX_DISC;
use crate::GachaError;

/// All instructions supported by the gacha-simple program.
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
        default_value = public_key("2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS")
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
        default_value = public_key("2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS")
    ))]
    BuyPull(#[codama(name = "buy_pull_data")] BuyPullData) = 1,

    #[codama(account(
        name = "operator",
        signer,
        writable,
        docs = "Registered VRF operator revealing the pull; funds the mint and ATA rent"
    ))]
    #[codama(account(name = "pool", writable, docs = "The pool being pulled from; mint and metadata authority"))]
    #[codama(account(name = "pull", writable, docs = "The pending pull being settled and closed"))]
    #[codama(account(name = "buyer", writable, docs = "The pull's buyer; receives the prize NFT and the pull rent"))]
    #[codama(account(
        name = "mint",
        writable,
        docs = "Prize mint PDA for the pull",
        default_value = pda("prize_mint", [seed("pull", account("pull"))])
    ))]
    #[codama(account(name = "buyer_ata", writable, docs = "Buyer's associated token account for the prize mint"))]
    #[codama(account(name = "system_program", docs = "The system program", default_value = program("system")))]
    #[codama(account(
        name = "token_program",
        docs = "The Token-2022 program",
        default_value = public_key("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    ))]
    #[codama(account(
        name = "ata_program",
        docs = "The associated token account program",
        default_value = public_key("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    ))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS")
    ))]
    SettleAndDistribute(#[codama(name = "settle_and_distribute_data")] SettleAndDistributeData) = 2,

    #[codama(account(name = "buyer", signer, writable, docs = "The pull's buyer reclaiming their entry fee"))]
    #[codama(account(name = "pool", writable, docs = "The pool the pull belongs to"))]
    #[codama(account(name = "pull", writable, docs = "The pending pull being refunded and closed"))]
    #[codama(account(name = "vault", writable, docs = "Pot vault PDA for the pool"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS")
    ))]
    RefundPull = 3,

    #[codama(account(name = "admin", signer, writable, docs = "Pool admin receiving the fees"))]
    #[codama(account(name = "pool", docs = "The pool whose fees are withdrawn"))]
    #[codama(account(name = "vault", writable, docs = "Pot vault PDA for the pool"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS")
    ))]
    WithdrawFees(#[codama(name = "withdraw_fees_data")] WithdrawFeesData) = 4,

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
            buy_pull::DISCRIMINATOR => Ok(Self::BuyPull(BuyPullData::load(rest)?.clone())),
            settle_and_distribute::DISCRIMINATOR => {
                Ok(Self::SettleAndDistribute(SettleAndDistributeData::load(rest)?.clone()))
            }
            refund_pull::DISCRIMINATOR => Ok(Self::RefundPull),
            withdraw_fees::DISCRIMINATOR => Ok(Self::WithdrawFees(WithdrawFeesData::load(rest)?.clone())),
            &EMIT_EVENT_IX_DISC => Ok(Self::EmitEvent),
            _ => Err(GachaError::InvalidInstruction.into()),
        }
    }
}

impl fmt::Display for GachaInstruction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InitPool(_) => write!(f, "init_pool"),
            Self::BuyPull(_) => write!(f, "buy_pull"),
            Self::SettleAndDistribute(_) => write!(f, "settle_and_distribute"),
            Self::RefundPull => write!(f, "refund_pull"),
            Self::WithdrawFees(_) => write!(f, "withdraw_fees"),
            Self::EmitEvent => write!(f, "emit_event"),
        }
    }
}
