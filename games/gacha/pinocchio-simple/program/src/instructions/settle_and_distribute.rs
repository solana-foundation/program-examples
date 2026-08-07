use core::mem::{size_of, transmute};

use codama::CodamaType;
use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{
    event_engine::{self, EventSerialize},
    events::PullSettledEvent,
    gacha::{
        format_hex, select_tier, METADATA_BETA_KEY, METADATA_CLIENT_SEED_KEY, METADATA_PROOF_KEY, METADATA_PULL_KEY,
        METADATA_RARITY_KEY, RARITY_LABELS,
    },
    instructions::helpers::{check_signer, check_system_program, check_writable, mint_prize_nft, PrizeNftAccounts},
    state::{common::find_mint_pda, pool::Pool, pull::Pull},
    GachaError,
};

/// Instruction discriminator byte for `SettleAndDistribute`.
pub const DISCRIMINATOR: &u8 = &2;

/// Instruction data for [`SettleAndDistribute`](crate::GachaInstruction::SettleAndDistribute).
#[repr(C, packed)]
#[derive(CodamaType, Debug, Clone)]
pub struct SettleAndDistributeData {
    /// The 80-byte RFC 9381 ECVRF proof for the pull's `alpha`. Recorded in the
    /// prize NFT's metadata and emitted for off-chain verification.
    pub proof: [u8; 80],
    /// The 64-byte ECVRF output. Drives tier selection.
    pub beta: [u8; 64],
}

impl SettleAndDistributeData {
    pub const LEN: usize = size_of::<Self>();

    pub fn load(data: &[u8]) -> Result<&Self, ProgramError> {
        if data.len() != Self::LEN {
            return Err(GachaError::InvalidInstruction.into());
        }
        Ok(unsafe { &*transmute::<*const u8, *const Self>(data.as_ptr()) })
    }
}

/// Validated accounts for [`SettleAndDistribute`](crate::GachaInstruction::SettleAndDistribute).
pub struct SettleAndDistributeAccounts<'a> {
    pub operator: &'a AccountView,
    pub pool: &'a mut AccountView,
    pub pull: &'a mut AccountView,
    pub buyer: &'a mut AccountView,
    pub mint: &'a AccountView,
    pub buyer_ata: &'a AccountView,
    pub system_program: &'a AccountView,
    pub token_program: &'a AccountView,
    pub ata_program: &'a AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for SettleAndDistributeAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [operator, pool, pull, buyer, mint, buyer_ata, system_program, token_program, ata_program, event_authority, self_program] =
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
        check_writable(buyer)?;
        check_writable(mint)?;
        check_writable(buyer_ata)?;
        check_system_program(system_program)?;

        if token_program.address() != &pinocchio_token_2022::ID {
            return Err(GachaError::NotTokenProgram.into());
        }
        if ata_program.address() != &pinocchio_associated_token_account::ID {
            return Err(GachaError::NotAtaProgram.into());
        }

        Ok(Self {
            operator,
            pool,
            pull,
            buyer,
            mint,
            buyer_ata,
            system_program,
            token_program,
            ata_program,
            event_authority,
            self_program,
        })
    }
}

/// Reveals a pending pull and delivers its prize in one step: selects a tier
/// from `beta` against the pool's fixed weights, mints the prize — a Token-2022
/// NFT whose metadata carries the rarity and the full reveal provenance
/// (`pull`, `client_seed`, `beta`, `proof`, all lowercase hex) — to the buyer,
/// closes the pull (rent back to the buyer), and emits a [`PullSettledEvent`].
///
/// One reveal per pull is structural: the prize mint is a PDA of the pull that
/// can only be created once, the pull account closes here, and pull addresses
/// are seeded by a monotonic pool index so a settled pull can never be
/// re-created. The NFT is self-certifying — its metadata `update_authority` is
/// the pool PDA, so from the mint and the pool account it names anyone can
/// recompute `alpha = SHA-256(pull || client_seed)` and verify
/// `beta = VRF(pool.operator, alpha)` off-chain.
pub fn process(accounts: &mut [AccountView], data: &SettleAndDistributeData) -> ProgramResult {
    let accounts = SettleAndDistributeAccounts::try_from(accounts)?;

    let admin;
    let pool_bump;
    let weights;
    let tier_count;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        pool.check_operator(accounts.operator.address())?;
        admin = pool.admin;
        pool_bump = pool.bump;
        weights = pool.weights;
        tier_count = pool.tier_count;
    }

    let alpha;
    let client_seed;
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
        alpha = pull.alpha;
        client_seed = pull.client_seed;
        index = pull.index;
    }

    let (mint_pda, mint_bump) = find_mint_pda(accounts.pull.address());
    if mint_pda != *accounts.mint.address() {
        return Err(GachaError::InvalidMintPda.into());
    }

    let proof = data.proof;
    let beta = data.beta;
    let tier = select_tier(&beta, &weights, tier_count)?;
    let rarity = RARITY_LABELS.get(tier as usize).ok_or(GachaError::InvalidTierConfig)?;

    let mut pull_hex = [0u8; 64];
    let mut seed_hex = [0u8; 64];
    let mut beta_hex = [0u8; 128];
    let mut proof_hex = [0u8; 160];
    let provenance = [
        (METADATA_RARITY_KEY, *rarity),
        (METADATA_PULL_KEY, format_hex(accounts.pull.address().as_ref(), &mut pull_hex)),
        (METADATA_CLIENT_SEED_KEY, format_hex(&client_seed, &mut seed_hex)),
        (METADATA_BETA_KEY, format_hex(&beta, &mut beta_hex)),
        (METADATA_PROOF_KEY, format_hex(&proof, &mut proof_hex)),
    ];

    let nft_accounts = PrizeNftAccounts {
        payer: accounts.operator,
        pool: accounts.pool,
        buyer: accounts.buyer,
        mint: accounts.mint,
        buyer_ata: accounts.buyer_ata,
        system_program: accounts.system_program,
        token_program: accounts.token_program,
    };
    mint_prize_nft(&nft_accounts, &admin, pool_bump, accounts.pull.address(), mint_bump, index, &provenance)?;

    {
        let mut pool_data = accounts.pool.try_borrow_mut()?;
        let pool = Pool::load_mut(&mut pool_data)?;
        pool.pending_pulls = pool.pending_pulls.checked_sub(1).ok_or(GachaError::ArithmeticOverflow)?;
    }

    let rent_refund = accounts.pull.lamports();
    let buyer_lamports = accounts.buyer.lamports().checked_add(rent_refund).ok_or(GachaError::ArithmeticOverflow)?;
    accounts.pull.set_lamports(0);
    accounts.buyer.set_lamports(buyer_lamports);
    accounts.pull.close()?;

    let event = PullSettledEvent::new(
        *accounts.pool.address(),
        *accounts.buyer.address(),
        index,
        tier,
        alpha,
        beta,
        proof,
        mint_pda,
    );
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
