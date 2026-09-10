use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};

mod create_collection;
mod mint_nft;
mod verify_collection;

pub use create_collection::*;
pub use mint_nft::*;
pub use verify_collection::*;

/// Size (in bytes) of an SPL Token mint account.
pub const MINT_SIZE: usize = 82;

/// Decimals for the minted token. NFTs use 0 decimals (the mint has a supply of
/// exactly one indivisible token).
pub const TOKEN_DECIMALS: u8 = 0;

/// Seed prefix for the program's mint-authority PDA (`[b"authority"]`). The PDA
/// is never initialized — it exists only to sign the Metaplex CPIs.
pub const AUTHORITY_SEED: &[u8] = b"authority";

/// Seed prefix for a collection's authority-tracking PDA
/// (`[b"collection_authority", collection_mint]`). Records which wallet created
/// the collection, since the `[b"authority"]` PDA that actually signs Metaplex
/// CPIs is global and signs unconditionally for whoever calls
/// `verify_collection` — this account is what gates that.
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection_authority";

/// Size (in bytes) of a collection-authority account: just the raw 32-byte
/// creator pubkey. No discriminator — this program has only one custom account
/// type, and the account only ever exists at its derived PDA address if this
/// program's own `create_collection` created it there.
pub const COLLECTION_AUTHORITY_LEN: usize = 32;

/// Errors specific to this program's own authorization checks (distinct from
/// the underlying Metaplex/SPL CPI errors).
#[derive(Debug, Clone, Copy)]
pub enum NftOperationsError {
    /// The signer is not the collection's recorded creator.
    Unauthorized = 1,
}

impl From<NftOperationsError> for ProgramError {
    fn from(e: NftOperationsError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// The Metaplex Token Metadata program ID
/// (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`).
pub const TOKEN_METADATA_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// Discriminator of the Metaplex `CreateMetadataAccountV3` instruction.
const CREATE_METADATA_ACCOUNT_V3: u8 = 33;
/// Discriminator of the Metaplex `CreateMasterEditionV3` instruction.
const CREATE_MASTER_EDITION_V3: u8 = 17;
/// Discriminator of the Metaplex `Verify` instruction.
const VERIFY: u8 = 52;
/// `VerificationArgs::CollectionV1` variant index, the argument to `Verify`.
const VERIFY_COLLECTION_V1: u8 = 1;

/// Serializes the data for a Metaplex `CreateMetadataAccountV3` instruction.
///
/// Layout: `[33] DataV2 is_mutable:bool collection_details:Option`, where
/// `DataV2` is `name:string symbol:string uri:string seller_fee:u16
/// creators:Option collection:Option uses:Option`.
///
/// The single creator is the mint-authority PDA, marked `verified` (it signs the
/// CPI). `collection` links a member NFT to its collection; `collection_details`
/// marks the metadata itself as a (sized) collection. The two are mutually
/// exclusive in this example, matching the Anchor sources.
pub(crate) fn build_metadata_data(
    name: &str,
    symbol: &str,
    uri: &str,
    creator: &[u8; 32],
    collection: Option<&[u8; 32]>,
    is_collection: bool,
) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(CREATE_METADATA_ACCOUNT_V3);

    // DataV2
    push_borsh_string(&mut data, name.as_bytes());
    push_borsh_string(&mut data, symbol.as_bytes());
    push_borsh_string(&mut data, uri.as_bytes());
    data.extend_from_slice(&0u16.to_le_bytes()); // seller_fee_basis_points

    // creators: Some(vec![Creator { address, verified: true, share: 100 }])
    data.push(1); // Option: Some
    data.extend_from_slice(&1u32.to_le_bytes()); // vec length
    data.extend_from_slice(creator); // address
    data.push(1); // verified: true
    data.push(100); // share

    // collection: Option<Collection { verified: bool, key: Pubkey }>
    match collection {
        Some(key) => {
            data.push(1); // Option: Some
            data.push(0); // verified: false (set true by verify_collection)
            data.extend_from_slice(key);
        }
        None => data.push(0), // Option: None
    }

    data.push(0); // uses: None

    data.push(1); // is_mutable: true

    // collection_details: Option<CollectionDetails::V1 { size: u64 }>
    if is_collection {
        data.push(1); // Option: Some
        data.push(0); // CollectionDetails::V1
        data.extend_from_slice(&0u64.to_le_bytes()); // size
    } else {
        data.push(0); // Option: None
    }

    data
}

/// Serializes the data for a Metaplex `CreateMasterEditionV3` instruction.
///
/// Layout: `[17] max_supply:Option<u64>`. A `max_supply` of `Some(0)` allows no
/// printed editions (a one-of-one), matching the Anchor sources.
pub(crate) fn build_master_edition_data() -> Vec<u8> {
    let mut data = Vec::new();
    data.push(CREATE_MASTER_EDITION_V3);
    data.push(1); // max_supply: Some
    data.extend_from_slice(&0u64.to_le_bytes()); // max_supply value
    data
}

/// Serializes the data for a Metaplex `Verify` instruction with
/// `VerificationArgs::CollectionV1`. Layout: `[52, 1]`.
pub(crate) fn build_verify_collection_data() -> [u8; 2] {
    [VERIFY, VERIFY_COLLECTION_V1]
}

/// Invokes Metaplex `CreateMetadataAccountV3`, signed by the mint-authority PDA.
///
/// Accounts (Metaplex order): metadata (w), mint, mint_authority (signer),
/// payer (w, signer), update_authority, system_program. The optional rent
/// account is omitted.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_metadata_cpi(
    metadata: &AccountView,
    mint: &AccountView,
    mint_authority: &AccountView,
    payer: &AccountView,
    system_program: &AccountView,
    data: &[u8],
    signers: &[Signer],
) -> ProgramResult {
    let accounts = [
        InstructionAccount::writable(metadata.address()),
        InstructionAccount::readonly(mint.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::writable_signer(payer.address()),
        // Update authority — the same PDA; recorded only, not required to sign.
        InstructionAccount::readonly(mint_authority.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let instruction = InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &accounts, data };
    invoke_signed(&instruction, &[*metadata, *mint, *mint_authority, *payer, *mint_authority, *system_program], signers)
}

/// Invokes Metaplex `CreateMasterEditionV3`, signed by the mint-authority PDA.
///
/// Accounts (Metaplex order): edition (w), mint (w), update_authority (signer),
/// mint_authority (signer), payer (w, signer), metadata (w), token_program,
/// system_program. The optional rent account is omitted.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_master_edition_cpi(
    edition: &AccountView,
    mint: &AccountView,
    mint_authority: &AccountView,
    payer: &AccountView,
    metadata: &AccountView,
    token_program: &AccountView,
    system_program: &AccountView,
    signers: &[Signer],
) -> ProgramResult {
    let data = build_master_edition_data();
    let accounts = [
        InstructionAccount::writable(edition.address()),
        InstructionAccount::writable(mint.address()),
        // Update authority and mint authority are the same PDA here.
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable(metadata.address()),
        InstructionAccount::readonly(token_program.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let instruction = InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &accounts, data: &data };
    invoke_signed(
        &instruction,
        &[*edition, *mint, *mint_authority, *mint_authority, *payer, *metadata, *token_program, *system_program],
        signers,
    )
}

/// Appends a Borsh `string` (4-byte little-endian length prefix + UTF-8 bytes).
fn push_borsh_string(buffer: &mut Vec<u8>, value: &[u8]) {
    buffer.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buffer.extend_from_slice(value);
}
