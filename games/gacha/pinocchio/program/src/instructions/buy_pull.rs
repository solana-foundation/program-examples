use pinocchio::{
    cpi::Seed,
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_system::instructions::Transfer;

use crate::{
    event_engine::{self, EventSerialize},
    events::PullRequestedEvent,
    instructions::helpers::{check_signer, check_system_program, check_writable, create_pda_account},
    state::{
        common::{find_pull_pda, find_vault_pda, PULL_SEED},
        pool::Pool,
        pull::Pull,
    },
    GachaError,
};

/// Instruction discriminator byte for `BuyPull`.
pub const DISCRIMINATOR: &u8 = &1;

/// Validated accounts for [`BuyPull`](crate::GachaInstruction::BuyPull).
pub struct BuyPullAccounts<'a> {
    pub buyer: &'a AccountView,
    pub pool: &'a mut AccountView,
    pub pull: &'a mut AccountView,
    pub vault: &'a AccountView,
    pub system_program: &'a AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for BuyPullAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [buyer, pool, pull, vault, system_program, event_authority, self_program] = accounts else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(buyer)?;
        check_writable(buyer)?;
        check_writable(pool)?;
        Pool::check(pool)?;
        check_writable(pull)?;
        check_writable(vault)?;
        check_system_program(system_program)?;

        Ok(Self { buyer, pool, pull, vault, system_program, event_authority, self_program })
    }
}

/// Opens a pull: escrows the entry fee, commits the VRF input `alpha`, and emits a
/// [`PullRequestedEvent`]. The pull is created pending; the operator settles it later.
pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
    let accounts = BuyPullAccounts::try_from(accounts)?;

    let entry_fee;
    let index;
    let admin;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        entry_fee = pool.entry_fee;
        index = pool.pulls_count;
        admin = pool.admin;
    }

    if find_vault_pda(&admin).0 != *accounts.vault.address() {
        return Err(GachaError::InvalidVaultPda.into());
    }

    let pool_key = *accounts.pool.address();
    let (pull_pda, pull_bump) = find_pull_pda(&pool_key, accounts.buyer.address(), index);
    if pull_pda != *accounts.pull.address() {
        return Err(GachaError::InvalidPullPda.into());
    }
    if accounts.pull.data_len() > 0 {
        return Err(GachaError::PullAlreadyExists.into());
    }

    let mut alpha = [0u8; 32];
    alpha.copy_from_slice(pull_pda.as_ref());

    let pull_rent = Rent::get()?.try_minimum_balance(Pull::LEN)?;
    let pot_contribution = entry_fee.checked_sub(pull_rent).ok_or(GachaError::InvalidEntryFee)?;

    let index_bytes = index.to_le_bytes();
    let bump_bytes = [pull_bump];
    let seeds = [
        Seed::from(PULL_SEED),
        Seed::from(pool_key.as_ref()),
        Seed::from(accounts.buyer.address().as_ref()),
        Seed::from(&index_bytes[..]),
        Seed::from(&bump_bytes[..]),
    ];
    create_pda_account(accounts.buyer, accounts.pull, &seeds, Pull::LEN)?;

    if pot_contribution > 0 {
        Transfer { from: accounts.buyer, to: accounts.vault, lamports: pot_contribution }.invoke()?;
    }

    {
        let mut pull_data = accounts.pull.try_borrow_mut()?;
        Pull::init(&mut pull_data, pull_bump, &pool_key, accounts.buyer.address(), index, &alpha)?;
    }

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        let next = pool.pulls_count.checked_add(1).ok_or(GachaError::ArithmeticOverflow)?;
        pool.pulls_count = next;
    }

    let event = PullRequestedEvent::new(pool_key, *accounts.buyer.address(), index, alpha);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
