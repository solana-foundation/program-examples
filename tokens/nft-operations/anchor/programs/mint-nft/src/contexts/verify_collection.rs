use crate::{errors::MintNftError, state::CollectionAuthority};
use anchor_lang::prelude::*;

use anchor_spl::metadata::mpl_token_metadata::instructions::{
    VerifyCollectionV1Cpi,
    VerifyCollectionV1CpiAccounts,
};
use anchor_spl::metadata::{
    MasterEditionAccount, 
    MetadataAccount,
};
use anchor_spl::{
    token::Mint, 
    metadata::Metadata, 
};
// In Anchor 1.0, sysvar::instructions::ID moved — use the well-known address directly
const INSTRUCTIONS_SYSVAR_ID: Pubkey = anchor_lang::solana_program::pubkey::pubkey!("Sysvar1nstructions1111111111111111111111111");

#[derive(Accounts)]
pub struct VerifyCollectionMint<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub metadata: Account<'info, MetadataAccount>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    /// CHECK: This account is not initialized and is being used for signing purposes only
    pub mint_authority: UncheckedAccount<'info>,
    pub collection_mint: Account<'info, Mint>,
    // Only the wallet recorded as this collection's creator at create_collection
    // time may verify NFTs into it — the mint_authority PDA otherwise signs
    // unconditionally for whoever calls this instruction.
    #[account(
        seeds = [b"collection_authority", collection_mint.key().as_ref()],
        bump,
        constraint = collection_authority.creator == authority.key() @ MintNftError::Unauthorized,
    )]
    pub collection_authority: Account<'info, CollectionAuthority>,
    #[account(mut)]
    pub collection_metadata: Account<'info, MetadataAccount>,
    pub collection_master_edition: Account<'info, MasterEditionAccount>,
    pub system_program: Program<'info, System>,
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    /// CHECK: Sysvar instruction account that is being checked with an address constraint
    pub sysvar_instruction: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
}

impl<'info> VerifyCollectionMint<'info> {
    pub fn verify_collection(&mut self, bumps: &VerifyCollectionMintBumps) -> Result<()> {
        let metadata = &self.metadata.to_account_info();
        let authority = &self.mint_authority.to_account_info();
        let collection_mint = &self.collection_mint.to_account_info();
        let collection_metadata = &self.collection_metadata.to_account_info();
        let collection_master_edition = &self.collection_master_edition.to_account_info();
        let system_program = &self.system_program.to_account_info();
        let sysvar_instructions = &self.sysvar_instruction.to_account_info();
        let spl_metadata_program = &self.token_metadata_program.to_account_info();

        let seeds = &[
            &b"authority"[..], 
            &[bumps.mint_authority]
        ];
        let signer_seeds = &[&seeds[..]];

        let verify_collection = VerifyCollectionV1Cpi::new(
            spl_metadata_program,
        VerifyCollectionV1CpiAccounts {
            authority,
            delegate_record: None,
            metadata,
            collection_mint,
            collection_metadata: Some(collection_metadata),
            collection_master_edition: Some(collection_master_edition),
            system_program,
            sysvar_instructions,
        });
        verify_collection.invoke_signed(signer_seeds)?;

        msg!("Collection Verified!");
        
        Ok(())
    }
}