use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    event_engine::{self, EventSerialize},
    events::FeesWithdrawnEvent,
    instructions::helpers::{check_signer, check_writable},
    state::{common::find_vault_pda, pool::Pool},
    GachaError,
};

/// Instruction discriminator byte for `WithdrawFees`.
pub const DISCRIMINATOR: &u8 = &4;

/// Instruction data for [`WithdrawFees`](crate::GachaInstruction::WithdrawFees).
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct WithdrawFeesData {
    /// Lamports to withdraw from the vault.
    pub amount: u64,
}

impl WithdrawFeesData {
    pub const LEN: usize = size_of::<Self>();

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(GachaError::InvalidInstruction.into());
        }
        Ok(unsafe { &*transmute::<*const u8, *const Self>(data.as_ptr()) })
    }
}

/// Validated accounts for [`WithdrawFees`](crate::GachaInstruction::WithdrawFees).
pub struct WithdrawFeesAccounts<'a> {
    pub admin: &'a mut AccountView,
    pub pool: &'a AccountView,
    pub vault: &'a mut AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for WithdrawFeesAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [admin, pool, vault, event_authority, self_program] = accounts else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(admin)?;
        check_writable(admin)?;
        Pool::check(pool)?;
        check_writable(vault)?;

        Ok(Self { admin, pool, vault, event_authority, self_program })
    }
}

/// Withdraws settled entry fees from the vault to the admin, and emits a
/// [`FeesWithdrawnEvent`].
///
/// The withdrawable amount is capped at the vault balance minus the vault's own
/// rent floor and minus `pending_pulls * entry_fee` — the fees still owed as
/// refunds if the operator never settles those pulls. The admin can therefore
/// only ever take revenue from *settled* pulls, never a pending buyer's escrow.
pub fn process(accounts: &mut [AccountView], data: &WithdrawFeesData) -> ProgramResult {
    let accounts = WithdrawFeesAccounts::try_from(accounts)?;

    let amount = data.amount;
    if amount == 0 {
        return Err(GachaError::InsufficientVaultFunds.into());
    }

    let entry_fee;
    let pending_pulls;
    let admin;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        pool.check_admin(accounts.admin.address())?;
        entry_fee = pool.entry_fee;
        pending_pulls = pool.pending_pulls;
        admin = pool.admin;
    }

    if find_vault_pda(&admin).0 != *accounts.vault.address() {
        return Err(GachaError::InvalidVaultPda.into());
    }

    let rent_floor = Rent::get()?.try_minimum_balance(0)?;
    let liability = pending_pulls.checked_mul(entry_fee).ok_or(GachaError::ArithmeticOverflow)?;
    let reserved = rent_floor.checked_add(liability).ok_or(GachaError::ArithmeticOverflow)?;
    let available = accounts.vault.lamports().saturating_sub(reserved);
    if amount > available {
        return Err(GachaError::InsufficientVaultFunds.into());
    }

    accounts.vault.set_lamports(accounts.vault.lamports() - amount);
    let admin_lamports = accounts.admin.lamports().checked_add(amount).ok_or(GachaError::ArithmeticOverflow)?;
    accounts.admin.set_lamports(admin_lamports);

    let event = FeesWithdrawnEvent::new(*accounts.pool.address(), admin, amount);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
