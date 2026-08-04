use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{
    event_engine::{self, EventSerialize},
    events::PrizeClaimedEvent,
    gacha::RARITY_LABELS,
    instructions::helpers::{check_signer, check_system_program, check_writable, mint_prize_nft, PrizeNftAccounts},
    state::{
        common::{find_mint_pda, PullStatus},
        pool::Pool,
        pull::Pull,
    },
    GachaError,
};

/// Instruction discriminator byte for `ClaimPrize`.
pub const DISCRIMINATOR: &u8 = &5;

/// Validated accounts for [`ClaimPrize`](crate::GachaInstruction::ClaimPrize).
pub struct ClaimPrizeAccounts<'a> {
    pub payer: &'a AccountView,
    pub pool: &'a AccountView,
    pub pull: &'a mut AccountView,
    pub buyer: &'a AccountView,
    pub mint: &'a AccountView,
    pub buyer_ata: &'a AccountView,
    pub system_program: &'a AccountView,
    pub token_program: &'a AccountView,
    pub ata_program: &'a AccountView,
    pub event_authority: &'a AccountView,
    pub self_program: &'a AccountView,
}

impl<'a> TryFrom<&'a mut [AccountView]> for ClaimPrizeAccounts<'a> {
    type Error = ProgramError;

    fn try_from(accounts: &'a mut [AccountView]) -> Result<Self, Self::Error> {
        let [payer, pool, pull, buyer, mint, buyer_ata, system_program, token_program, ata_program, event_authority, self_program] =
            accounts
        else {
            return Err(GachaError::NotEnoughAccountKeys.into());
        };

        check_signer(payer)?;
        check_writable(payer)?;
        Pool::check(pool)?;
        check_writable(pull)?;
        Pull::check(pull)?;
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
            payer,
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

/// Mints a settled pull's prize: a Token-2022 NFT whose in-mint metadata carries
/// the pull's rarity, delivered to the buyer's associated token account. Emits a
/// [`PrizeClaimedEvent`].
///
/// Permissionless: any funded signer may crank a claim (the buyer, the operator,
/// or an indexer). The payer funds the mint and ATA rent; the prize always goes
/// to the pull's buyer. The mint is a PDA of the pull, so each pull has exactly
/// one prize, and the mint authority is discarded after minting a supply of one.
pub fn process(accounts: &mut [AccountView]) -> ProgramResult {
    let accounts = ClaimPrizeAccounts::try_from(accounts)?;

    let tier;
    let index;
    {
        let pull_data = accounts.pull.try_borrow()?;
        let pull = Pull::load(&pull_data)?;
        if PullStatus::try_from(pull.status)? != PullStatus::Settled {
            return Err(GachaError::PullNotSettled.into());
        }
        if pull.pool != *accounts.pool.address() {
            return Err(GachaError::PoolMismatch.into());
        }
        if pull.buyer != *accounts.buyer.address() {
            return Err(GachaError::BuyerMismatch.into());
        }
        tier = pull.tier_selected;
        index = pull.index;
    }

    let admin;
    let pool_bump;
    {
        let pool_data = accounts.pool.try_borrow()?;
        let pool = Pool::load(&pool_data)?;
        admin = pool.admin;
        pool_bump = pool.bump;
    }

    let (mint_pda, mint_bump) = find_mint_pda(accounts.pull.address());
    if mint_pda != *accounts.mint.address() {
        return Err(GachaError::InvalidMintPda.into());
    }

    let rarity = RARITY_LABELS.get(tier as usize).ok_or(GachaError::InvalidTierConfig)?;

    let nft_accounts = PrizeNftAccounts {
        payer: accounts.payer,
        pool: accounts.pool,
        buyer: accounts.buyer,
        mint: accounts.mint,
        buyer_ata: accounts.buyer_ata,
        system_program: accounts.system_program,
        token_program: accounts.token_program,
    };
    mint_prize_nft(&nft_accounts, &admin, pool_bump, accounts.pull.address(), mint_bump, index, rarity)?;

    {
        let mut pull_data = accounts.pull.try_borrow_mut()?;
        let pull = Pull::load_mut(&mut pull_data)?;
        pull.claim();
    }

    let event = PrizeClaimedEvent::new(*accounts.pool.address(), *accounts.buyer.address(), index, tier, mint_pda);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
