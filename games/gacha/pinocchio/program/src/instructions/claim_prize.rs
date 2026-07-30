use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_system::instructions::Transfer;
use pinocchio_token_2022::instructions::{metadata_pointer, AuthorityType, InitializeMint2, MintTo, SetAuthority};

use crate::{
    event_engine::{self, EventSerialize},
    events::PrizeClaimedEvent,
    gacha::{format_u64, NFT_NAME_PREFIX, NFT_SYMBOL, NFT_URI, RARITY_LABELS},
    instructions::helpers::{check_signer, check_system_program, check_writable, create_pda_account},
    state::{
        common::{find_mint_pda, PullStatus, MINT_SEED, POOL_SEED},
        pool::Pool,
        pull::Pull,
    },
    GachaError,
};

/// Instruction discriminator byte for `ClaimPrize`.
pub const DISCRIMINATOR: &u8 = &5;

/// SPL token-metadata-interface instruction discriminators
/// (`sha256("spl_token_metadata_interface:<hash_input>")[..8]`).
const TOKEN_METADATA_INITIALIZE_DISC: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const TOKEN_METADATA_UPDATE_FIELD_DISC: [u8; 8] = [221, 233, 49, 45, 181, 202, 220, 200];
/// `Field::Key(String)` variant tag in the token-metadata-interface `Field` enum.
const FIELD_KEY_VARIANT: u8 = 3;
/// Metadata key under which each prize records its tier label.
const RARITY_KEY: &str = "rarity";

/// Size of a Token-2022 mint account carrying a `MetadataPointer` extension:
/// 82-byte base mint + 83-byte padding to the account-type offset + 1-byte
/// account type + 4-byte TLV header + 64-byte metadata-pointer state. Matches
/// `ExtensionType::try_calculate_account_len::<Mint>(&[MetadataPointer])`.
const MINT_LEN: usize = 234;

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
    let mut digits = [0u8; 20];
    let index_str = format_u64(index, &mut digits);

    let pull_key = *accounts.pull.address();
    let mint_bump_bytes = [mint_bump];
    let mint_seeds = [Seed::from(MINT_SEED), Seed::from(pull_key.as_ref()), Seed::from(&mint_bump_bytes[..])];

    let pool_bump_bytes = [pool_bump];
    let pool_seeds = [Seed::from(POOL_SEED), Seed::from(admin.as_ref()), Seed::from(&pool_bump_bytes[..])];
    let pool_signer = [Signer::from(&pool_seeds[..])];

    let rent = Rent::get()?;
    let pool_address = accounts.pool.address();

    create_pda_account(accounts.payer, accounts.mint, &mint_seeds, MINT_LEN, &pinocchio_token_2022::ID)?;

    metadata_pointer::Initialize {
        mint: accounts.mint,
        authority: Some(pool_address),
        metadata_address: Some(accounts.mint.address()),
        token_program: &pinocchio_token_2022::ID,
    }
    .invoke()?;

    InitializeMint2 {
        mint: accounts.mint,
        decimals: 0,
        mint_authority: pool_address,
        freeze_authority: None,
        token_program: &pinocchio_token_2022::ID,
    }
    .invoke()?;

    // The in-mint TokenMetadata TLV entry that Initialize + UpdateField below
    // will grow the account to: a 4-byte TLV header, the update authority and
    // mint (32 each), three borsh strings, and one (key, value) pair. Token-2022
    // checks rent-exemption at the final size on each metadata write, so the
    // account is topped up for the full layout before the first write.
    let name_len = NFT_NAME_PREFIX.len() + index_str.len();
    let metadata_len = 4
        + 64
        + (4 + name_len)
        + (4 + NFT_SYMBOL.len())
        + (4 + NFT_URI.len())
        + 4
        + (4 + RARITY_KEY.len())
        + (4 + rarity.len());
    let funded = rent.try_minimum_balance(MINT_LEN)?;
    let required = rent.try_minimum_balance(MINT_LEN + metadata_len)?;
    let top_up = required.saturating_sub(funded);
    if top_up > 0 {
        Transfer { from: accounts.payer, to: accounts.mint, lamports: top_up }.invoke()?;
    }

    let mut init_data = Vec::with_capacity(8 + 4 + name_len + 4 + NFT_SYMBOL.len() + 4 + NFT_URI.len());
    init_data.extend_from_slice(&TOKEN_METADATA_INITIALIZE_DISC);
    init_data.extend_from_slice(&(name_len as u32).to_le_bytes());
    init_data.extend_from_slice(NFT_NAME_PREFIX.as_bytes());
    init_data.extend_from_slice(index_str.as_bytes());
    init_data.extend_from_slice(&(NFT_SYMBOL.len() as u32).to_le_bytes());
    init_data.extend_from_slice(NFT_SYMBOL.as_bytes());
    init_data.extend_from_slice(&(NFT_URI.len() as u32).to_le_bytes());
    init_data.extend_from_slice(NFT_URI.as_bytes());

    // Accounts: metadata, update authority, mint, mint authority — the metadata
    // lives in the mint itself and the pool PDA is both authorities.
    let metadata_metas = [
        InstructionAccount::writable(accounts.mint.address()),
        InstructionAccount::readonly(pool_address),
        InstructionAccount::readonly(accounts.mint.address()),
        InstructionAccount::readonly_signer(pool_address),
    ];
    invoke_signed(
        &InstructionView { program_id: &pinocchio_token_2022::ID, accounts: &metadata_metas, data: &init_data },
        &[accounts.mint, accounts.pool, accounts.mint, accounts.pool],
        &pool_signer,
    )?;

    let mut field_data = Vec::with_capacity(8 + 1 + 4 + RARITY_KEY.len() + 4 + rarity.len());
    field_data.extend_from_slice(&TOKEN_METADATA_UPDATE_FIELD_DISC);
    field_data.push(FIELD_KEY_VARIANT);
    field_data.extend_from_slice(&(RARITY_KEY.len() as u32).to_le_bytes());
    field_data.extend_from_slice(RARITY_KEY.as_bytes());
    field_data.extend_from_slice(&(rarity.len() as u32).to_le_bytes());
    field_data.extend_from_slice(rarity.as_bytes());

    let field_metas =
        [InstructionAccount::writable(accounts.mint.address()), InstructionAccount::readonly_signer(pool_address)];
    invoke_signed(
        &InstructionView { program_id: &pinocchio_token_2022::ID, accounts: &field_metas, data: &field_data },
        &[accounts.mint, accounts.pool],
        &pool_signer,
    )?;

    CreateIdempotent {
        funding_account: accounts.payer,
        account: accounts.buyer_ata,
        wallet: accounts.buyer,
        mint: accounts.mint,
        system_program: accounts.system_program,
        token_program: accounts.token_program,
    }
    .invoke()?;

    MintTo {
        mint: accounts.mint,
        account: accounts.buyer_ata,
        mint_authority: accounts.pool,
        amount: 1,
        token_program: &pinocchio_token_2022::ID,
    }
    .invoke_signed(&pool_signer)?;

    SetAuthority {
        account: accounts.mint,
        authority: accounts.pool,
        authority_type: AuthorityType::MintTokens,
        new_authority: None,
        token_program: &pinocchio_token_2022::ID,
    }
    .invoke_signed(&pool_signer)?;

    {
        let mut pull_data = accounts.pull.try_borrow_mut()?;
        let pull = Pull::load_mut(&mut pull_data)?;
        pull.claim();
    }

    let event = PrizeClaimedEvent::new(*accounts.pool.address(), *accounts.buyer.address(), index, tier, mint_pda);
    event_engine::emit_event(&crate::ID, accounts.event_authority, accounts.self_program, &event.to_bytes())?;

    Ok(())
}
