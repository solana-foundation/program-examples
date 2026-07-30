//! Shared account discriminator, pull status, PDA seeds, and derivation helpers.

use codama::CodamaType;
use pinocchio::{error::ProgramError, Address};

use crate::GachaError;

/// PDA seed prefix for pool accounts.
pub const POOL_SEED: &[u8] = b"pool";
/// PDA seed prefix for per-pool pot vaults.
pub const VAULT_SEED: &[u8] = b"vault";
/// PDA seed prefix for pull accounts.
pub const PULL_SEED: &[u8] = b"pull";
/// PDA seed prefix for per-pull prize mints.
pub const MINT_SEED: &[u8] = b"mint";

/// One-byte discriminator identifying the type of a program-owned account.
///
/// Stored at byte offset 0 of every data-carrying account created by this program.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Debug, CodamaType)]
pub enum AccountDiscriminator {
    /// [`Pool`](super::pool::Pool) account.
    Pool = 0,
    /// [`Pull`](super::pull::Pull) account.
    Pull = 1,
}

impl TryFrom<u8> for AccountDiscriminator {
    type Error = ProgramError;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Pool),
            1 => Ok(Self::Pull),
            _ => Err(GachaError::InvalidAccountDiscriminator.into()),
        }
    }
}

impl From<AccountDiscriminator> for u8 {
    fn from(val: AccountDiscriminator) -> Self {
        val as u8
    }
}

/// Lifecycle state of a single pull, stored in [`Pull`](super::pull::Pull).
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Debug, CodamaType)]
pub enum PullStatus {
    /// Committed and awaiting the operator's reveal (or a post-deadline refund).
    Pending = 0,
    /// Revealed: `beta` and the selected tier are recorded; prize not yet minted.
    Settled = 1,
    /// Prize NFT minted to the buyer.
    Claimed = 2,
}

impl TryFrom<u8> for PullStatus {
    type Error = ProgramError;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Pending),
            1 => Ok(Self::Settled),
            2 => Ok(Self::Claimed),
            _ => Err(GachaError::InvalidAccountData.into()),
        }
    }
}

/// Finds the pool PDA and bump for an admin.
pub fn find_pool_pda(admin: &Address) -> (Address, u8) {
    Address::find_program_address(&[POOL_SEED, admin.as_ref()], &crate::ID)
}

/// Finds the pot vault PDA and bump for an admin's pool.
pub fn find_vault_pda(admin: &Address) -> (Address, u8) {
    Address::find_program_address(&[VAULT_SEED, admin.as_ref()], &crate::ID)
}

/// Finds the pull PDA and bump for a `(pool, buyer, index)` triple.
pub fn find_pull_pda(pool: &Address, buyer: &Address, index: u64) -> (Address, u8) {
    Address::find_program_address(&[PULL_SEED, pool.as_ref(), buyer.as_ref(), &index.to_le_bytes()], &crate::ID)
}

/// Finds the prize mint PDA and bump for a pull.
pub fn find_mint_pda(pull: &Address) -> (Address, u8) {
    Address::find_program_address(&[MINT_SEED, pull.as_ref()], &crate::ID)
}
