use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{
    cpi::Seed,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_system::instructions::Transfer;

use crate::{
    event_engine::{self, EventSerialize},
    events::PullRequestedEvent,
    gacha::derive_alpha,
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

/// Instruction data for [`BuyPull`](crate::GachaInstruction::BuyPull).
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct BuyPullData {
    /// Buyer-supplied entropy mixed into the VRF input:
    /// `alpha = SHA-256(pull_address || client_seed)`. Should be 32 random bytes
    /// generated client-side; it is what makes the outcome unpredictable to the
    /// operator before the buy lands.
    pub client_seed: [u8; 32],
}

impl BuyPullData {
    pub const LEN: usize = size_of::<Self>();

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(GachaError::InvalidInstruction.into());
        }
        Ok(unsafe { &*transmute::<*const u8, *const Self>(data.as_ptr()) })
    }
}

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
/// [`PullRequestedEvent`]. The pull is created pending; the operator settles it
/// later, or the buyer refunds it after the pool's settle deadline.
///
/// The buyer pays the pull account's rent on top of the entry fee; the full
/// entry fee goes to the vault, and the rent comes back when the pull account
/// closes on refund.
pub fn process(accounts: &mut [AccountView], data: &BuyPullData) -> ProgramResult {
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

    let client_seed = data.client_seed;
    let alpha = derive_alpha(&pull_pda, &client_seed);
    let requested_slot = Clock::get()?.slot;

    let index_bytes = index.to_le_bytes();
    let bump_bytes = [pull_bump];
    let seeds = [
        Seed::from(PULL_SEED),
        Seed::from(pool_key.as_ref()),
        Seed::from(accounts.buyer.address().as_ref()),
        Seed::from(&index_bytes[..]),
        Seed::from(&bump_bytes[..]),
    ];
    create_pda_account(accounts.buyer, accounts.pull, &seeds, Pull::LEN, &crate::ID)?;

    Transfer { from: accounts.buyer, to: accounts.vault, lamports: entry_fee }.invoke()?;

    {
        let mut pull_data = accounts.pull.try_borrow_mut()?;
        Pull::init(
            &mut pull_data,
            pull_bump,
            &pool_key,
            accounts.buyer.address(),
            index,
            &client_seed,
            &alpha,
            requested_slot,
        )?;
    }

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        pool.pulls_count = pool.pulls_count.checked_add(1).ok_or(GachaError::ArithmeticOverflow)?;
        pool.pending_pulls = pool.pending_pulls.checked_add(1).ok_or(GachaError::ArithmeticOverflow)?;
    }

    let event = PullRequestedEvent::new(pool_key, *accounts.buyer.address(), index, client_seed, alpha);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
