use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, ProgramResult,
};

use crate::{
    ccvrf::{self, LightCommitContext},
    event_engine::{self, EventSerialize},
    events::PullSettledEvent,
    gacha::select_tier,
    instructions::helpers::{check_signer, check_writable},
    state::{common::PullStatus, pool::Pool, pull::Pull},
    GachaError,
};

/// Instruction discriminator byte for `SettlePull`.
pub const DISCRIMINATOR: &u8 = &2;

/// Instruction data for [`SettlePull`](crate::GachaInstruction::SettlePull).
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct SettlePullData {
    /// The 80-byte RFC 9381 ECVRF proof for the pull's `alpha`. Hashed into the
    /// cc-vrf registry commit and emitted for off-chain verification.
    pub proof: [u8; 80],
    /// The 64-byte ECVRF output. Drives tier selection and is anchored
    /// verbatim (split lo/hi) in the registry commit.
    pub beta: [u8; 64],
    /// Light Protocol context for the cc-vrf CPI.
    pub light: LightCommitContext,
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
///
/// The Light passthrough accounts are forwarded opaquely to the cc-vrf CPI,
/// which — together with the Light system program — validates them and rejects
/// any address tree other than the canonical one. Only the CPI target itself is
/// pinned during account validation, so a settle cannot be redirected at an
/// impostor program.
pub struct SettlePullAccounts<'a> {
    pub operator: &'a AccountView,
    pub pool: &'a mut AccountView,
    pub pull: &'a mut AccountView,
    pub cc_vrf_program: &'a AccountView,
    pub light_system: &'a AccountView,
    pub cpi_authority: &'a AccountView,
    pub registered_program: &'a AccountView,
    pub compression_authority: &'a AccountView,
    pub compression_program: &'a AccountView,
    pub system_program: &'a AccountView,
    pub authority_tree: &'a AccountView,
    pub authority_queue: &'a AccountView,
    pub address_tree: &'a AccountView,
    pub output_queue: &'a AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for SettlePullAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [operator, pool, pull, cc_vrf_program, light_system, cpi_authority, registered_program, compression_authority, compression_program, system_program, authority_tree, authority_queue, address_tree, output_queue, event_authority, self_program] =
            accounts
        else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(operator)?;
        check_writable(operator)?;
        check_writable(pool)?;
        Pool::check(pool)?;
        check_writable(pull)?;
        Pull::check(pull)?;

        if cc_vrf_program.address() != &ccvrf::CC_VRF_PROGRAM_ID {
            return Err(GachaError::NotCcVrfProgram.into());
        }

        Ok(Self {
            operator,
            pool,
            pull,
            cc_vrf_program,
            light_system,
            cpi_authority,
            registered_program,
            compression_authority,
            compression_program,
            system_program,
            authority_tree,
            authority_queue,
            address_tree,
            output_queue,
            event_authority,
            self_program,
        })
    }
}

/// Reveals a pending pull: anchors the ECVRF output in the cc-vrf registry via
/// CPI, selects a tier from `beta` against the pool's fixed weights, records the
/// result, and emits a [`PullSettledEvent`] carrying the proof.
///
/// The registry commit's address derives from the operator's authority record
/// and `memo_hash = SHA-256(pull_address)`, so each pull can be committed at
/// most once — an operator cannot re-roll a reveal even before this program's
/// own status check. The commit also proves (via Light validity proof) that the
/// operator's registration is frozen and unrevoked, and that its ECVRF key is
/// exactly `pool.operator`.
pub fn process(accounts: &mut [AccountView], data: &SettlePullData) -> ProgramResult {
    let accounts = SettlePullAccounts::try_from(accounts)?;
    let slot = Clock::get()?.slot;

    let operator_key;
    let authority_label;
    let weights;
    let tier_count;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        pool.check_operator(accounts.operator.address())?;
        operator_key = pool.operator;
        authority_label = pool.authority_label;
        weights = pool.weights;
        tier_count = pool.tier_count;
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

    let proof = data.proof;
    let beta = data.beta;
    let light = data.light;

    let memo_hash = solana_sha256_hasher::hashv(&[accounts.pull.address().as_ref()]).to_bytes();
    let proof_hash = solana_sha256_hasher::hashv(&[&proof]).to_bytes();
    let alpha_hash = solana_sha256_hasher::hashv(&[&alpha]).to_bytes();

    ccvrf::commit_proof_with_beta(
        &[
            accounts.operator,
            accounts.light_system,
            accounts.cpi_authority,
            accounts.registered_program,
            accounts.compression_authority,
            accounts.compression_program,
            accounts.system_program,
            accounts.authority_tree,
            accounts.authority_queue,
            accounts.address_tree,
            accounts.output_queue,
        ],
        &operator_key,
        &authority_label,
        &light,
        &memo_hash,
        &proof_hash,
        &alpha_hash,
        &beta,
    )?;

    let tier = select_tier(&beta, &weights, tier_count)?;

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        pool.pending_pulls = pool.pending_pulls.checked_sub(1).ok_or(GachaError::ArithmeticOverflow)?;
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
