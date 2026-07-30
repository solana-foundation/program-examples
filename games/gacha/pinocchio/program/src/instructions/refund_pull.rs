use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    event_engine::{self, EventSerialize},
    events::PullRefundedEvent,
    instructions::helpers::{check_signer, check_writable},
    state::{common::find_vault_pda, common::PullStatus, pool::Pool, pull::Pull},
    GachaError,
};

/// Instruction discriminator byte for `RefundPull`.
pub const DISCRIMINATOR: &u8 = &3;

/// Validated accounts for [`RefundPull`](crate::GachaInstruction::RefundPull).
pub struct RefundPullAccounts<'a> {
    pub buyer: &'a mut AccountView,
    pub pool: &'a mut AccountView,
    pub pull: &'a mut AccountView,
    pub vault: &'a mut AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for RefundPullAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [buyer, pool, pull, vault, event_authority, self_program] = accounts else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(buyer)?;
        check_writable(buyer)?;
        check_writable(pool)?;
        Pool::check(pool)?;
        check_writable(pull)?;
        Pull::check(pull)?;
        check_writable(vault)?;

        Ok(Self { buyer, pool, pull, vault, event_authority, self_program })
    }
}

/// Refunds a pull the operator failed to settle within the pool's deadline: the
/// entry fee moves back from the vault to the buyer, the pull account closes
/// (returning its rent to the buyer), and a [`PullRefundedEvent`] is emitted.
///
/// This is the liveness escape hatch of the commit-reveal scheme — an operator
/// who withholds a reveal (for example after seeing an unfavorable `beta`) can
/// delay a payout, but can never keep the buyer's funds. A refunded pull can
/// never be re-created: pull PDAs are seeded by a monotonic pool index.
pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
    let accounts = RefundPullAccounts::try_from(accounts)?;

    let entry_fee;
    let settle_deadline_slots;
    let admin;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        entry_fee = pool.entry_fee;
        settle_deadline_slots = pool.settle_deadline_slots;
        admin = pool.admin;
    }

    if find_vault_pda(&admin).0 != *accounts.vault.address() {
        return Err(GachaError::InvalidVaultPda.into());
    }

    let index;
    {
        let pull_data = accounts.pull.try_borrow()?;
        let pull = Pull::load(&pull_data)?;
        if pull.pool != *accounts.pool.address() {
            return Err(GachaError::PoolMismatch.into());
        }
        if pull.buyer != *accounts.buyer.address() {
            return Err(GachaError::BuyerMismatch.into());
        }
        if PullStatus::try_from(pull.status)? != PullStatus::Pending {
            return Err(GachaError::PullNotPending.into());
        }
        let deadline = pull.requested_slot.checked_add(settle_deadline_slots).ok_or(GachaError::ArithmeticOverflow)?;
        if Clock::get()?.slot <= deadline {
            return Err(GachaError::RefundTooEarly.into());
        }
        index = pull.index;
    }

    let vault_lamports = accounts.vault.lamports().checked_sub(entry_fee).ok_or(GachaError::InsufficientVaultFunds)?;
    accounts.vault.set_lamports(vault_lamports);
    let refund = entry_fee.checked_add(accounts.pull.lamports()).ok_or(GachaError::ArithmeticOverflow)?;
    let buyer_lamports = accounts.buyer.lamports().checked_add(refund).ok_or(GachaError::ArithmeticOverflow)?;
    accounts.pull.set_lamports(0);
    accounts.buyer.set_lamports(buyer_lamports);
    accounts.pull.close()?;

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        pool.pending_pulls = pool.pending_pulls.checked_sub(1).ok_or(GachaError::ArithmeticOverflow)?;
    }

    let event = PullRefundedEvent::new(*accounts.pool.address(), *accounts.buyer.address(), index, entry_fee);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
