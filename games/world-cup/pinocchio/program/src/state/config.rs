//! Singleton config account: tournament admin, lifecycle state, and the global tally.

use codama::CodamaAccount;
use core::mem::{size_of, transmute};
use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{
    state::common::{AccountDiscriminator, TournamentState},
    WorldCupError,
};

/// The singleton tournament config and provable global tally.
///
/// `best_score`/`best_closeness`/`best_index` form the on-chain ranking key: the
/// highest score, tiebroken by the smallest `|guess - actual_goals|`, and finally by
/// the smallest submission index (earliest entrant wins). Because the index is unique
/// per bracket, the key is total, exactly one bracket can match it. The key is only
/// meaningful once the oracle is complete and `refreshed_count == entrant_count`.
///
/// **PDA seeds:** `["config"]`
#[repr(C, packed)]
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "config"))]
pub struct Config {
    /// Account type discriminator ([`AccountDiscriminator::Config`]).
    pub discriminator: u8,
    /// PDA bump seed.
    pub bump: u8,
    /// Current [`TournamentState`].
    pub state: u8,
    /// Authority that posts oracle results and finalizes.
    pub admin: Address,
    /// Unix timestamp at/after which registration closes and `lock` may be called.
    pub lock_ts: i64,
    /// Entry fee per bracket, in lamports.
    pub entry_fee: u64,
    /// Number of brackets submitted.
    pub entrant_count: u32,
    /// Number of brackets folded into the tally at [`tally_mask`](Self::tally_mask).
    pub refreshed_count: u32,
    /// `decided_mask` the current tally corresponds to (0 until the first fold).
    pub tally_mask: u32,
    /// Best (highest) weighted score seen.
    pub best_score: u16,
    /// Tiebreaker closeness of the best key (smaller is better).
    pub best_closeness: u16,
    /// Submission index of the best key (smaller is better; final tiebreaker).
    pub best_index: u32,
    /// Recorded unique winner (zeroed until `finalize`).
    pub winner: Address,
}

impl Config {
    /// Total serialized size in bytes.
    pub const LEN: usize = size_of::<Self>();

    /// PDA seed prefix.
    pub const SEED: &'static [u8] = b"config";

    /// Initializes a freshly created account.
    #[inline(always)]
    pub fn init(bytes: &mut [u8], bump: u8, admin: &Address, lock_ts: i64, entry_fee: u64) -> Result<(), ProgramError> {
        if bytes.len() != Self::LEN {
            return Err(WorldCupError::InvalidAccountData.into());
        }
        let account = unsafe { &mut *transmute::<*mut u8, *mut Self>(bytes.as_mut_ptr()) };
        account.discriminator = AccountDiscriminator::Config as u8;
        account.bump = bump;
        account.state = TournamentState::Registration as u8;
        account.admin = *admin;
        account.lock_ts = lock_ts;
        account.entry_fee = entry_fee;
        account.entrant_count = 0;
        account.refreshed_count = 0;
        account.tally_mask = 0;
        account.best_score = 0;
        account.best_closeness = u16::MAX;
        account.best_index = u32::MAX;
        account.winner = Address::default();
        Ok(())
    }

    /// Deserializes a mutable reference from raw account data.
    #[inline(always)]
    pub fn load_mut(bytes: &mut [u8]) -> Result<&mut Self, ProgramError> {
        Self::validate(bytes)?;
        Ok(unsafe { &mut *transmute::<*mut u8, *mut Self>(bytes.as_mut_ptr()) })
    }

    /// Deserializes an immutable reference from raw account data.
    #[inline(always)]
    pub fn load(bytes: &[u8]) -> Result<&Self, ProgramError> {
        Self::validate(bytes)?;
        Ok(unsafe { &*transmute::<*const u8, *const Self>(bytes.as_ptr()) })
    }

    /// Verifies an account is a genuine config: owned by this program, correctly
    /// sized, and carrying the config discriminator. Call in account validation.
    pub fn check(account: &AccountView) -> Result<(), ProgramError> {
        if !account.owned_by(&crate::ID) {
            return Err(WorldCupError::NotProgramOwned.into());
        }
        Self::validate(&account.try_borrow()?)
    }

    fn validate(bytes: &[u8]) -> Result<(), ProgramError> {
        if bytes.len() != Self::LEN {
            return Err(WorldCupError::InvalidAccountData.into());
        }
        if bytes[0] != AccountDiscriminator::Config as u8 {
            return Err(WorldCupError::InvalidAccountDiscriminator.into());
        }
        Ok(())
    }

    /// Asserts `signer` is the recorded admin.
    pub fn check_admin(&self, signer: &Address) -> Result<(), ProgramError> {
        if self.admin != *signer {
            return Err(WorldCupError::Unauthorized.into());
        }
        Ok(())
    }
}
