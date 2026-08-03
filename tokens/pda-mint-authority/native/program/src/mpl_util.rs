//! Hand-rolled instructions for the Metaplex Token Metadata program.
//!
//! Builds the instructions this example needs directly from their wire format
//! (discriminator + borsh-encoded args + documented account order), so the
//! program does not depend on the `mpl-token-metadata` crate.

use {
    borsh::BorshSerialize,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
    },
};

/// The Metaplex Token Metadata program
/// (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`).
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    11, 112, 101, 177, 227, 209, 124, 69, 56, 157, 82, 127, 107, 4, 195, 205, 88, 184, 108, 115, 26, 160, 253, 181, 73,
    182, 209, 188, 3, 248, 41, 70,
]);

/// Variant 33 of the Token Metadata program's instruction enum.
const CREATE_METADATA_ACCOUNT_V3: u8 = 33;

/// Metaplex `DataV2`. The three `Option` fields (creators, collection, uses)
/// are always `None` in these examples; a `None` of any inner type serializes
/// to the same single zero byte under borsh.
#[derive(BorshSerialize)]
struct DataV2 {
    name: String,
    symbol: String,
    uri: String,
    seller_fee_basis_points: u16,
    creators: Option<u8>,
    collection: Option<u8>,
    uses: Option<u8>,
}

#[derive(BorshSerialize)]
struct CreateMetadataAccountArgsV3 {
    data: DataV2,
    is_mutable: bool,
    collection_details: Option<u8>,
}

/// `CreateMetadataAccountV3`: creates the metadata account for `mint`.
///
/// Account order (from the Token Metadata program):
/// metadata (writable), mint, mint authority (signer), payer (writable
/// signer), update authority (signer), system program. The trailing rent
/// sysvar is optional and omitted.
#[allow(clippy::too_many_arguments)]
pub fn create_metadata_account_v3(
    metadata: &Pubkey,
    mint: &Pubkey,
    mint_authority: &Pubkey,
    payer: &Pubkey,
    update_authority: &Pubkey,
    system_program: &Pubkey,
    name: String,
    symbol: String,
    uri: String,
) -> Instruction {
    let args = CreateMetadataAccountArgsV3 {
        data: DataV2 { name, symbol, uri, seller_fee_basis_points: 0, creators: None, collection: None, uses: None },
        is_mutable: false,
        collection_details: None,
    };
    let mut data = vec![CREATE_METADATA_ACCOUNT_V3];
    args.serialize(&mut data).expect("serializing to a Vec cannot fail");

    Instruction {
        program_id: TOKEN_METADATA_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*metadata, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(*mint_authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*update_authority, true),
            AccountMeta::new_readonly(*system_program, false),
        ],
        data,
    }
}

/// Variant 17 of the Token Metadata program's instruction enum.
const CREATE_MASTER_EDITION_V3: u8 = 17;

#[derive(BorshSerialize)]
struct CreateMasterEditionArgs {
    max_supply: Option<u64>,
}

/// `CreateMasterEditionV3`: creates the master edition for `mint`, marking it
/// as an NFT and taking over its mint/freeze authorities.
///
/// Account order (from the Token Metadata program):
/// edition (writable), mint (writable), update authority (signer), mint
/// authority (signer), payer (writable signer), metadata (writable), token
/// program, system program. The trailing rent sysvar is optional and omitted.
#[allow(clippy::too_many_arguments)]
pub fn create_master_edition_v3(
    edition: &Pubkey,
    mint: &Pubkey,
    update_authority: &Pubkey,
    mint_authority: &Pubkey,
    payer: &Pubkey,
    metadata: &Pubkey,
    token_program: &Pubkey,
    system_program: &Pubkey,
    max_supply: u64,
) -> Instruction {
    let args = CreateMasterEditionArgs { max_supply: Some(max_supply) };
    let mut data = vec![CREATE_MASTER_EDITION_V3];
    args.serialize(&mut data).expect("serializing to a Vec cannot fail");

    Instruction {
        program_id: TOKEN_METADATA_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*edition, false),
            AccountMeta::new(*mint, false),
            AccountMeta::new_readonly(*update_authority, true),
            AccountMeta::new_readonly(*mint_authority, true),
            AccountMeta::new(*payer, true),
            AccountMeta::new(*metadata, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(*system_program, false),
        ],
        data,
    }
}
