//! Pull account: one gacha pull, from commit through reveal.

use codama::CodamaAccount;
use core::mem::{size_of, transmute};
use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{
    state::common::{AccountDiscriminator, PullStatus},
    GachaError,
};

/// Sentinel `tier_selected` value while a pull is still pending.
pub const TIER_UNSET: u8 = u8::MAX;

/// A single pull against a [`Pool`](super::pool::Pool).
///
/// Created at commit with a fixed VRF input `alpha = SHA-256(pull_address ||
/// client_seed)`, where `client_seed` is buyer-supplied entropy — so the operator
/// cannot precompute `beta` for a pull that has not been bought yet. On reveal the
/// operator supplies `beta`; the program records it, the selected `tier`, and the
/// `settled_slot`. The 80-byte proof is not stored — it is anchored in the cc-vrf
/// registry and emitted in the settle event for off-chain verification.
///
/// **PDA seeds:** `["pull", pool, buyer, index_le]`
#[repr(C, packed)]
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "pull"))]
#[codama(seed(name = "pool", type = public_key))]
#[codama(seed(name = "buyer", type = public_key))]
#[codama(seed(name = "index", type = number(u64)))]
pub struct Pull {
    /// Account type discriminator ([`AccountDiscriminator::Pull`]).
    pub discriminator: u8,
    /// PDA bump seed.
    pub bump: u8,
    /// Current [`PullStatus`].
    pub status: u8,
    /// Selected tier index once settled; [`TIER_UNSET`] while pending.
    pub tier_selected: u8,
    /// Pool this pull belongs to.
    pub pool: Address,
    /// Buyer that opened (and owns) this pull.
    pub buyer: Address,
    /// Pool pull index at commit; part of this account's seeds.
    pub index: u64,
    /// Buyer-supplied entropy mixed into `alpha`; stored so anyone can recompute
    /// `alpha` and verify it was not operator-chosen.
    pub client_seed: [u8; 32],
    /// VRF input, fixed at commit: `SHA-256(pull_address || client_seed)`.
    pub alpha: [u8; 32],
    /// VRF output recorded at reveal; zeroed while pending.
    pub beta: [u8; 64],
    /// Slot at which the pull was opened; refunds unlock
    /// `pool.settle_deadline_slots` after this.
    pub requested_slot: u64,
    /// Slot at which the pull was settled; zero while pending.
    pub settled_slot: u64,
}

impl Pull {
    /// Total serialized size in bytes.
    pub const LEN: usize = size_of::<Self>();

    /// PDA seed prefix.
    pub const SEED: &'static [u8] = b"pull";

    /// Initializes a freshly created pending pull.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        bytes: &mut [u8],
        bump: u8,
        pool: &Address,
        buyer: &Address,
        index: u64,
        client_seed: &[u8; 32],
        alpha: &[u8; 32],
        requested_slot: u64,
    ) -> Result<(), ProgramError> {
        if bytes.len() != Self::LEN {
            return Err(GachaError::InvalidAccountData.into());
        }
        let account = unsafe { &mut *transmute::<*mut u8, *mut Self>(bytes.as_mut_ptr()) };
        account.discriminator = AccountDiscriminator::Pull as u8;
        account.bump = bump;
        account.status = PullStatus::Pending as u8;
        account.tier_selected = TIER_UNSET;
        account.pool = *pool;
        account.buyer = *buyer;
        account.index = index;
        account.client_seed = *client_seed;
        account.alpha = *alpha;
        account.beta = [0u8; 64];
        account.requested_slot = requested_slot;
        account.settled_slot = 0;
        Ok(())
    }

    /// Records the reveal: stores `beta`, the selected `tier`, the `slot`, and marks settled.
    #[inline(always)]
    pub fn settle(&mut self, beta: &[u8; 64], tier: u8, slot: u64) {
        self.beta = *beta;
        self.tier_selected = tier;
        self.settled_slot = slot;
        self.status = PullStatus::Settled as u8;
    }

    /// Marks the prize as minted.
    #[inline(always)]
    pub fn claim(&mut self) {
        self.status = PullStatus::Claimed as u8;
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

    /// Verifies an account is a genuine pull: owned by this program, correctly
    /// sized, and carrying the pull discriminator. Call in account validation.
    pub fn check(account: &AccountView) -> Result<(), ProgramError> {
        if !account.owned_by(&crate::ID) {
            return Err(GachaError::NotProgramOwned.into());
        }
        Self::validate(&account.try_borrow()?)
    }

    fn validate(bytes: &[u8]) -> Result<(), ProgramError> {
        if bytes.len() != Self::LEN {
            return Err(GachaError::InvalidAccountData.into());
        }
        if bytes[0] != AccountDiscriminator::Pull as u8 {
            return Err(GachaError::InvalidAccountDiscriminator.into());
        }
        Ok(())
    }
}
