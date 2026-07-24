use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    event_engine::{self, EventSerialize},
    events::PullSettledEvent,
    gacha::select_tier,
    instructions::helpers::check_signer,
    state::{common::PullStatus, pool::Pool, pull::Pull},
    GachaError,
};

/// Instruction discriminator byte for `SettlePull`.
pub const DISCRIMINATOR: &u8 = &2;

/// Instruction data for [`SettlePull`](crate::GachaInstruction::SettlePull).
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct SettlePullData {
    /// The 64-byte ECVRF output for the pull's `alpha`.
    pub beta: [u8; 64],
    /// The 80-byte ECVRF proof, emitted for off-chain verification.
    pub proof: [u8; 80],
}

impl SettlePullData {
    pub const LEN: usize = size_of::<Self>();

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(GachaError::InvalidInstruction.into());
        }
        Ok(unsafe { &*transmute::<*const u8, *const Self>(data.as_ptr()) })
    }
}

/// Validated accounts for [`SettlePull`](crate::GachaInstruction::SettlePull).
pub struct SettlePullAccounts<'a> {
    pub operator: &'a AccountView,
    pub pool: &'a mut AccountView,
    pub pull: &'a mut AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for SettlePullAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [operator, pool, pull, event_authority, self_program] = accounts else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(operator)?;
        Pool::check(pool)?;
        Pull::check(pull)?;

        Ok(Self { operator, pool, pull, event_authority, self_program })
    }
}

/// Reveals a pending pull: selects a tier from `beta`, decrements its supply,
/// records the result, and emits a [`PullSettledEvent`] carrying the proof.
pub fn process(accounts: &mut [AccountView], data: &SettlePullData) -> ProgramResult {
    let accounts = SettlePullAccounts::try_from(accounts)?;
    let slot = Clock::get()?.slot;

    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        pool.check_operator(accounts.operator.address())?;
    }

    let alpha;
    let buyer;
    let index;
    {
        let pull_data = accounts.pull.try_borrow()?;
        let pull = Pull::load(&pull_data)?;
        if PullStatus::try_from(pull.status)? != PullStatus::Pending {
            return Err(GachaError::PullNotPending.into());
        }
        let pull_pool = pull.pool;
        if pull_pool != *accounts.pool.address() {
            return Err(GachaError::PoolMismatch.into());
        }
        alpha = pull.alpha;
        buyer = pull.buyer;
        index = pull.index;
    }

    let beta = data.beta;
    let proof = data.proof;

    let tier;
    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        let tier_count = pool.tier_count;
        let weights = pool.weights;
        let mut remaining = pool.remaining;
        let selected = select_tier(&beta, &weights, &remaining, tier_count)?;
        remaining[selected as usize] = remaining[selected as usize].checked_sub(1).ok_or(GachaError::PoolExhausted)?;
        pool.remaining = remaining;
        tier = selected;
    }

    {
        let mut pull_data = accounts.pull.try_borrow_mut()?;
        let pull = Pull::load_mut(&mut pull_data)?;
        pull.settle(&beta, tier, slot);
    }

    let pool_key = *accounts.pool.address();
    let event = PullSettledEvent::new(pool_key, buyer, index, tier, alpha, beta, proof);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
