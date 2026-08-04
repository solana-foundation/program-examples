//! Mints a pull's prize as a Token-2022 NFT carrying its rarity in-mint.
//!
//! The mint is a PDA of the pull, so each pull has exactly one prize. The pool
//! PDA signs as metadata-pointer authority, metadata update authority, and mint
//! authority; the mint authority is discarded once a supply of one is minted, so
//! the NFT can never be inflated.

use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_system::instructions::Transfer;
use pinocchio_token_2022::instructions::{metadata_pointer, AuthorityType, InitializeMint2, MintTo, SetAuthority};

use crate::{
    gacha::{format_u64, NFT_NAME_PREFIX, NFT_SYMBOL, NFT_URI},
    instructions::helpers::create_pda_account,
    state::common::{MINT_SEED, POOL_SEED},
};

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

/// Accounts the prize mint touches, in the order [`ClaimPrize`](crate::GachaInstruction::ClaimPrize) declares them.
pub struct PrizeNftAccounts<'a> {
    pub payer: &'a AccountView,
    pub pool: &'a AccountView,
    pub buyer: &'a AccountView,
    pub mint: &'a AccountView,
    pub buyer_ata: &'a AccountView,
    pub system_program: &'a AccountView,
    pub token_program: &'a AccountView,
}

/// Creates the prize mint, writes its metadata, and delivers a supply of one to
/// the buyer's associated token account.
///
/// `admin` and `pool_bump` reconstruct the pool PDA's signer seeds; `pull` and
/// `mint_bump` those of the mint. `index` is appended to the NFT name and
/// `rarity` is stored under the `rarity` metadata key.
pub fn mint_prize_nft(
    accounts: &PrizeNftAccounts,
    admin: &Address,
    pool_bump: u8,
    pull: &Address,
    mint_bump: u8,
    index: u64,
    rarity: &str,
) -> ProgramResult {
    let mint_bump_bytes = [mint_bump];
    let mint_seeds = [Seed::from(MINT_SEED), Seed::from(pull.as_ref()), Seed::from(&mint_bump_bytes[..])];

    let pool_bump_bytes = [pool_bump];
    let pool_seeds = [Seed::from(POOL_SEED), Seed::from(admin.as_ref()), Seed::from(&pool_bump_bytes[..])];
    let pool_signer = [Signer::from(&pool_seeds[..])];

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

    let mut digits = [0u8; 20];
    let index_str = format_u64(index, &mut digits);
    let name_len = NFT_NAME_PREFIX.len() + index_str.len();

    fund_metadata_rent(accounts, name_len, rarity)?;
    initialize_metadata(accounts, index_str, name_len, &pool_signer)?;
    set_rarity_field(accounts, rarity, &pool_signer)?;

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
    .invoke_signed(&pool_signer)
}

/// Tops the mint up to the rent floor of its final size, before any metadata is
/// written.
///
/// Token-2022 re-checks rent-exemption at the full account size on every
/// metadata write, so the account must already hold rent for the TLV entry that
/// [`initialize_metadata`] and [`set_rarity_field`] grow it to: a 4-byte TLV
/// header, the update authority and mint (32 each), three borsh strings, and one
/// `(key, value)` pair.
fn fund_metadata_rent(accounts: &PrizeNftAccounts, name_len: usize, rarity: &str) -> ProgramResult {
    let metadata_len = 4
        + 64
        + (4 + name_len)
        + (4 + NFT_SYMBOL.len())
        + (4 + NFT_URI.len())
        + 4
        + (4 + RARITY_KEY.len())
        + (4 + rarity.len());

    let rent = Rent::get()?;
    let funded = rent.try_minimum_balance(MINT_LEN)?;
    let required = rent.try_minimum_balance(MINT_LEN + metadata_len)?;
    let top_up = required.saturating_sub(funded);
    if top_up > 0 {
        Transfer { from: accounts.payer, to: accounts.mint, lamports: top_up }.invoke()?;
    }

    Ok(())
}

/// Writes the NFT's name, symbol, and URI into the mint itself.
fn initialize_metadata(
    accounts: &PrizeNftAccounts,
    index_str: &str,
    name_len: usize,
    pool_signer: &[Signer],
) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 4 + name_len + 4 + NFT_SYMBOL.len() + 4 + NFT_URI.len());
    data.extend_from_slice(&TOKEN_METADATA_INITIALIZE_DISC);
    data.extend_from_slice(&(name_len as u32).to_le_bytes());
    data.extend_from_slice(NFT_NAME_PREFIX.as_bytes());
    data.extend_from_slice(index_str.as_bytes());
    data.extend_from_slice(&(NFT_SYMBOL.len() as u32).to_le_bytes());
    data.extend_from_slice(NFT_SYMBOL.as_bytes());
    data.extend_from_slice(&(NFT_URI.len() as u32).to_le_bytes());
    data.extend_from_slice(NFT_URI.as_bytes());

    // Accounts: metadata, update authority, mint, mint authority — the metadata
    // lives in the mint itself and the pool PDA is both authorities.
    let pool_address = accounts.pool.address();
    let metas = [
        InstructionAccount::writable(accounts.mint.address()),
        InstructionAccount::readonly(pool_address),
        InstructionAccount::readonly(accounts.mint.address()),
        InstructionAccount::readonly_signer(pool_address),
    ];

    invoke_signed(
        &InstructionView { program_id: &pinocchio_token_2022::ID, accounts: &metas, data: &data },
        &[accounts.mint, accounts.pool, accounts.mint, accounts.pool],
        pool_signer,
    )
}

/// Adds the `rarity` entry to the mint's `additional_metadata`.
fn set_rarity_field(accounts: &PrizeNftAccounts, rarity: &str, pool_signer: &[Signer]) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 1 + 4 + RARITY_KEY.len() + 4 + rarity.len());
    data.extend_from_slice(&TOKEN_METADATA_UPDATE_FIELD_DISC);
    data.push(FIELD_KEY_VARIANT);
    data.extend_from_slice(&(RARITY_KEY.len() as u32).to_le_bytes());
    data.extend_from_slice(RARITY_KEY.as_bytes());
    data.extend_from_slice(&(rarity.len() as u32).to_le_bytes());
    data.extend_from_slice(rarity.as_bytes());

    let pool_address = accounts.pool.address();
    let metas =
        [InstructionAccount::writable(accounts.mint.address()), InstructionAccount::readonly_signer(pool_address)];

    invoke_signed(
        &InstructionView { program_id: &pinocchio_token_2022::ID, accounts: &metas, data: &data },
        &[accounts.mint, accounts.pool],
        pool_signer,
    )
}
