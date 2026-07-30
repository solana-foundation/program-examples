//! Pool account: gacha machine configuration, reward tiers, and pull counter.

use codama::CodamaAccount;
use core::mem::{size_of, transmute};
use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{gacha::MAX_TIERS, state::common::AccountDiscriminator, GachaError};

/// A gacha pool: one machine, owned by an admin.
///
/// Holds the fixed entry fee, the registered off-chain VRF `operator` (whose
/// cc-vrf authority registration is pinned by `authority_label`), the fixed tier
/// `weights`, a monotonic `pulls_count` used to derive unique pull accounts, and
/// `pending_pulls` tracking outstanding refund liabilities. One pool per admin
/// wallet.
///
/// **PDA seeds:** `["pool", admin]`
#[repr(C, packed)]
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "pool"))]
#[codama(seed(name = "admin", type = public_key))]
pub struct Pool {
    /// Account type discriminator ([`AccountDiscriminator::Pool`]).
    pub discriminator: u8,
    /// PDA bump seed.
    pub bump: u8,
    /// Number of active tiers (leading entries of `weights`).
    pub tier_count: u8,
    /// Admin that configured and owns this pool.
    pub admin: Address,
    /// Registered VRF operator; the only signer allowed to settle pulls. Doubles
    /// as the ECVRF public key and as the `owner` of the cc-vrf authority record.
    pub operator: Address,
    /// Label of the operator's cc-vrf authority registration; together with
    /// `operator` it pins the exact frozen registry record settles must use.
    pub authority_label: [u8; 32],
    /// Entry fee per pull, in lamports. Escrowed in the vault until the pull is
    /// settled (operator revenue) or refunded (returned to the buyer).
    pub entry_fee: u64,
    /// Number of pulls opened against this pool; the next pull's index.
    pub pulls_count: u64,
    /// Pulls still awaiting settle or refund. The vault must always hold at
    /// least `pending_pulls * entry_fee` on top of its rent floor.
    pub pending_pulls: u64,
    /// Slots after a pull's `requested_slot` before the buyer may claim a refund.
    pub settle_deadline_slots: u64,
    /// Relative draw weight per tier. Fixed at init, so tier odds are identical
    /// for every pull and independent of settle order.
    pub weights: [u32; 8],
}

impl Pool {
    /// Total serialized size in bytes.
    pub const LEN: usize = size_of::<Self>();

    /// PDA seed prefix.
    pub const SEED: &'static [u8] = b"pool";

    /// Initializes a freshly created account.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        bytes: &mut [u8],
        bump: u8,
        admin: &Address,
        operator: &Address,
        authority_label: &[u8; 32],
        entry_fee: u64,
        settle_deadline_slots: u64,
        weights: &[u32; MAX_TIERS],
        tier_count: u8,
    ) -> Result<(), ProgramError> {
        if bytes.len() != Self::LEN {
            return Err(GachaError::InvalidAccountData.into());
        }
        let account = unsafe { &mut *transmute::<*mut u8, *mut Self>(bytes.as_mut_ptr()) };
        account.discriminator = AccountDiscriminator::Pool as u8;
        account.bump = bump;
        account.tier_count = tier_count;
        account.admin = *admin;
        account.operator = *operator;
        account.authority_label = *authority_label;
        account.entry_fee = entry_fee;
        account.pulls_count = 0;
        account.pending_pulls = 0;
        account.settle_deadline_slots = settle_deadline_slots;
        account.weights = *weights;
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

    /// Verifies an account is a genuine pool: owned by this program, correctly
    /// sized, and carrying the pool discriminator. Call in account validation.
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
        if bytes[0] != AccountDiscriminator::Pool as u8 {
            return Err(GachaError::InvalidAccountDiscriminator.into());
        }
        Ok(())
    }

    /// Asserts `signer` is the recorded admin.
    pub fn check_admin(&self, signer: &Address) -> Result<(), ProgramError> {
        if self.admin != *signer {
            return Err(GachaError::Unauthorized.into());
        }
        Ok(())
    }

    /// Asserts `signer` is the recorded operator.
    pub fn check_operator(&self, signer: &Address) -> Result<(), ProgramError> {
        if self.operator != *signer {
            return Err(GachaError::NotOperator.into());
        }
        Ok(())
    }
}
