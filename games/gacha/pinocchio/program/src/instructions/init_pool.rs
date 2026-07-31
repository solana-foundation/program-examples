use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};

use crate::{
    event_engine::{self, EventSerialize},
    events::PoolInitializedEvent,
    gacha::MAX_TIERS,
    instructions::helpers::{check_signer, check_system_program, check_writable, create_pda_account},
    state::{
        common::{find_pool_pda, find_vault_pda, POOL_SEED, VAULT_SEED},
        pool::Pool,
    },
    GachaError,
};

/// Instruction discriminator byte for `InitPool`.
pub const DISCRIMINATOR: &u8 = &0;

/// Instruction data for [`InitPool`](crate::GachaInstruction::InitPool).
///
/// `weights` is fixed-length; only the first `tier_count` entries are used.
/// Remaining entries should be zero.
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct InitPoolData {
    /// VRF operator registered as the only signer allowed to settle pulls. Must
    /// match the `owner` and ECVRF `pk` of a frozen cc-vrf authority record.
    pub operator: Address,
    /// Label of the operator's cc-vrf authority registration.
    pub authority_label: [u8; 32],
    /// Entry fee per pull, in lamports.
    pub entry_fee: u64,
    /// Slots a pull may stay pending before the buyer can claim a refund.
    pub settle_deadline_slots: u64,
    /// Number of active tiers.
    pub tier_count: u8,
    /// Relative draw weight per tier.
    pub weights: [u32; 8],
}

impl InitPoolData {
    pub const LEN: usize = size_of::<Self>();

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(GachaError::InvalidInstruction.into());
        }
        Ok(unsafe { &*transmute::<*const u8, *const Self>(data.as_ptr()) })
    }
}

/// Validated accounts for [`InitPool`](crate::GachaInstruction::InitPool).
pub struct InitPoolAccounts<'a> {
    pub admin: &'a AccountView,
    pub pool: &'a mut AccountView,
    pub vault: &'a AccountView,
    pub system_program: &'a AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for InitPoolAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [admin, pool, vault, system_program, event_authority, self_program] = accounts else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(admin)?;
        check_writable(admin)?;
        check_writable(pool)?;
        check_writable(vault)?;
        check_system_program(system_program)?;

        Ok(Self { admin, pool, vault, system_program, event_authority, self_program })
    }
}

/// Creates a pool and its pot vault, and emits a [`PoolInitializedEvent`].
pub fn process(accounts: &mut [AccountView], data: &InitPoolData) -> ProgramResult {
    let accounts = InitPoolAccounts::try_from(accounts)?;

    let operator = data.operator;
    let authority_label = data.authority_label;
    let entry_fee = data.entry_fee;
    let settle_deadline_slots = data.settle_deadline_slots;
    let tier_count = data.tier_count;
    let weights = data.weights;

    if tier_count == 0 || tier_count as usize > MAX_TIERS {
        return Err(GachaError::TooManyTiers.into());
    }
    for &weight in &weights[..tier_count as usize] {
        if weight == 0 {
            return Err(GachaError::InvalidTierConfig.into());
        }
    }
    for &weight in &weights[tier_count as usize..] {
        if weight != 0 {
            return Err(GachaError::InvalidTierConfig.into());
        }
    }

    if entry_fee == 0 {
        return Err(GachaError::InvalidEntryFee.into());
    }
    if settle_deadline_slots == 0 {
        return Err(GachaError::InvalidSettleDeadline.into());
    }

    // The operator address doubles as the ECVRF public key, so it must be a
    // valid curve point. On-curve here only rules out malformed keys; that the
    // operator actually controls the ECVRF secret is attested by its frozen
    // cc-vrf authority record, checked at settle.
    if operator == Address::default() || operator == *accounts.admin.address() || !operator.is_on_curve() {
        return Err(GachaError::InvalidOperator.into());
    }

    if accounts.pool.data_len() > 0 {
        return Err(GachaError::PoolAlreadyExists.into());
    }

    let (pool_pda, pool_bump) = find_pool_pda(accounts.admin.address());
    if pool_pda != *accounts.pool.address() {
        return Err(GachaError::InvalidPoolPda.into());
    }
    let (vault_pda, vault_bump) = find_vault_pda(accounts.admin.address());
    if vault_pda != *accounts.vault.address() {
        return Err(GachaError::InvalidVaultPda.into());
    }

    let pool_bump_bytes = [pool_bump];
    let pool_seeds =
        [Seed::from(POOL_SEED), Seed::from(accounts.admin.address().as_ref()), Seed::from(&pool_bump_bytes[..])];
    create_pda_account(accounts.admin, accounts.pool, &pool_seeds, Pool::LEN, &crate::ID)?;

    let vault_bump_bytes = [vault_bump];
    let vault_seeds =
        [Seed::from(VAULT_SEED), Seed::from(accounts.admin.address().as_ref()), Seed::from(&vault_bump_bytes[..])];
    create_pda_account(accounts.admin, accounts.vault, &vault_seeds, 0, &crate::ID)?;

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        Pool::init(
            &mut pool_data,
            pool_bump,
            accounts.admin.address(),
            &operator,
            &authority_label,
            entry_fee,
            settle_deadline_slots,
            &weights,
            tier_count,
        )?;
    }

    let event = PoolInitializedEvent::new(
        *accounts.admin.address(),
        operator,
        authority_label,
        entry_fee,
        settle_deadline_slots,
        tier_count,
    );
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
