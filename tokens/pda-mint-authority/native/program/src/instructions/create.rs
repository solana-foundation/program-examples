use {
    borsh::{BorshDeserialize, BorshSerialize},
    mpl_token_metadata::{instructions::CreateMetadataAccountV3CpiBuilder, types::DataV2},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        msg,
        program::invoke,
        program_pack::Pack,
        pubkey::Pubkey,
        rent::Rent,
        sysvar::Sysvar,
    },
    solana_system_interface::instruction as system_instruction,
    spl_token_interface::{instruction as token_instruction, state::Mint},
};

use crate::state::MintAuthorityPda;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CreateTokenArgs {
    pub nft_title: String,
    pub nft_symbol: String,
    pub nft_uri: String,
}

pub fn create_token(program_id: &Pubkey, accounts: &[AccountInfo], args: CreateTokenArgs) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let mint_account = next_account_info(accounts_iter)?;
    let mint_authority = next_account_info(accounts_iter)?;
    let metadata_account = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let rent = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let token_metadata_program = next_account_info(accounts_iter)?;

    let (mint_authority_pda, bump) =
        Pubkey::find_program_address(&[MintAuthorityPda::SEED_PREFIX.as_bytes()], program_id);
    assert!(&mint_authority_pda.eq(mint_authority.key));

    // First create the account for the Mint
    //
    msg!("Creating mint account...");
    msg!("Mint: {}", mint_account.key);
    invoke(
        &system_instruction::create_account(
            payer.key,
            mint_account.key,
            (Rent::get()?).minimum_balance(Mint::LEN),
            Mint::LEN as u64,
            token_program.key,
        ),
        &[mint_account.clone(), payer.clone(), system_program.clone(), token_program.clone()],
    )?;

    // Now initialize that account as a Mint (standard Mint)
    //
    msg!("Initializing mint account...");
    msg!("Mint: {}", mint_account.key);
    invoke(
        &token_instruction::initialize_mint(
            token_program.key,
            mint_account.key,
            mint_authority.key,
            Some(mint_authority.key),
            0, // 0 Decimals for the NFT standard
        )?,
        &[mint_account.clone(), mint_authority.clone(), token_program.clone(), rent.clone()],
    )?;

    // Now create the account for that Mint's metadata
    //
    msg!("Creating metadata account...");
    msg!("Metadata account address: {}", metadata_account.key);
    CreateMetadataAccountV3CpiBuilder::new(token_metadata_program)
        .metadata(metadata_account)
        .mint(mint_account)
        .mint_authority(mint_authority)
        .payer(payer)
        .update_authority(mint_authority, true)
        .system_program(system_program)
        .data(DataV2 {
            name: args.nft_title,
            symbol: args.nft_symbol,
            uri: args.nft_uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        })
        .is_mutable(false)
        .invoke_signed(&[&[MintAuthorityPda::SEED_PREFIX.as_bytes(), &[bump]]])?;

    msg!("Token mint created successfully.");

    Ok(())
}
