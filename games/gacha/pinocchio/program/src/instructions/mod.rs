//! Instruction definitions and dispatch for the gacha program.
//!
//! Each instruction variant carries its own discriminator (the first byte of
//! instruction data). The Codama annotations on each variant describe the required
//! accounts in positional order.

pub mod buy_pull;
pub mod claim_prize;
pub mod emit_event;
pub mod helpers;
pub mod init_pool;
pub mod refund_pull;
pub mod settle_pull;
pub mod withdraw_fees;

pub use buy_pull::BuyPullData;
pub use helpers::*;
pub use init_pool::InitPoolData;
pub use settle_pull::SettlePullData;
pub use withdraw_fees::WithdrawFeesData;

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
    BuyPull(#[codama(name = "buy_pull_data")] BuyPullData) = 1,

    #[codama(account(
        name = "operator",
        signer,
        writable,
        docs = "Registered VRF operator revealing the pull; pays the cc-vrf commit"
    ))]
    #[codama(account(name = "pool", writable, docs = "The pool being pulled from"))]
    #[codama(account(name = "pull", writable, docs = "The pending pull being settled"))]
    #[codama(account(
        name = "cc_vrf_program",
        docs = "Collector Crypt's cc-vrf registry program",
        default_value = public_key("ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ")
    ))]
    #[codama(account(
        name = "light_system_program",
        docs = "Light Protocol system program",
        default_value = public_key("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7")
    ))]
    #[codama(account(
        name = "cc_vrf_cpi_authority",
        docs = "cc-vrf's CPI signer PDA",
        default_value = public_key("JEwC9hjj9yfWCQZQsMvy8zG92CcThefPxEp5T63UCFD")
    ))]
    #[codama(account(
        name = "registered_program_pda",
        docs = "Light registered-program PDA for cc-vrf",
        default_value = public_key("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh")
    ))]
    #[codama(account(
        name = "account_compression_authority",
        docs = "Light account-compression CPI authority",
        default_value = public_key("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA")
    ))]
    #[codama(account(
        name = "account_compression_program",
        docs = "Light account-compression program",
        default_value = public_key("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq")
    ))]
    #[codama(account(name = "system_program", docs = "The system program", default_value = program("system")))]
    #[codama(account(
        name = "authority_state_tree",
        writable,
        docs = "State tree holding the operator's cc-vrf authority record"
    ))]
    #[codama(account(name = "authority_queue", writable, docs = "Output queue of the authority's state tree"))]
    #[codama(account(
        name = "address_tree",
        writable,
        docs = "Canonical Light v2 batched address tree",
        default_value = public_key("amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx")
    ))]
    #[codama(account(name = "output_queue", writable, docs = "State tree queue receiving the new commit account"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    SettlePull(#[codama(name = "settle_pull_data")] SettlePullData) = 2,

    #[codama(account(name = "buyer", signer, writable, docs = "The pull's buyer reclaiming their entry fee"))]
    #[codama(account(name = "pool", writable, docs = "The pool the pull belongs to"))]
    #[codama(account(name = "pull", writable, docs = "The pending pull being refunded and closed"))]
    #[codama(account(name = "vault", writable, docs = "Pot vault PDA for the pool"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    RefundPull = 3,

    #[codama(account(name = "admin", signer, writable, docs = "Pool admin receiving the fees"))]
    #[codama(account(name = "pool", docs = "The pool whose fees are withdrawn"))]
    #[codama(account(name = "vault", writable, docs = "Pot vault PDA for the pool"))]
    #[codama(account(name = "event_authority", docs = "The event authority PDA", default_value = pda("event_authority", [])))]
    #[codama(account(
        name = "self_program",
        docs = "This program (for self-CPI event emission)",
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    WithdrawFees(#[codama(name = "withdraw_fees_data")] WithdrawFeesData) = 4,

    #[codama(account(name = "payer", signer, writable, docs = "Any signer; funds the mint and ATA rent"))]
    #[codama(account(name = "pool", docs = "The pool the pull belongs to; mint and metadata authority"))]
    #[codama(account(name = "pull", writable, docs = "The settled pull whose prize is minted"))]
    #[codama(account(name = "buyer", docs = "The pull's buyer; receives the prize NFT"))]
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
        default_value = public_key("Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS")
    ))]
    ClaimPrize = 5,

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
            settle_pull::DISCRIMINATOR => Ok(Self::SettlePull(SettlePullData::load(rest)?.clone())),
            refund_pull::DISCRIMINATOR => Ok(Self::RefundPull),
            withdraw_fees::DISCRIMINATOR => Ok(Self::WithdrawFees(WithdrawFeesData::load(rest)?.clone())),
            claim_prize::DISCRIMINATOR => Ok(Self::ClaimPrize),
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
            Self::SettlePull(_) => write!(f, "settle_pull"),
            Self::RefundPull => write!(f, "refund_pull"),
            Self::WithdrawFees(_) => write!(f, "withdraw_fees"),
            Self::ClaimPrize => write!(f, "claim_prize"),
            Self::EmitEvent => write!(f, "emit_event"),
        }
    }
}
