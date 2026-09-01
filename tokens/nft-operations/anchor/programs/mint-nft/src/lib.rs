use anchor_lang::prelude::*;

declare_id!("3EMcczaGi9ivdLxvvFwRbGYeEUEHpGwabXegARw4jLxa");

pub mod contexts;
pub mod errors;
pub mod state;

pub use contexts::*;

#[program]
pub mod mint_nft {

    use super::*;
    pub fn create_collection(ctx: Context<CreateCollection>) -> Result<()> {
        ctx.accounts.create_collection(&ctx.bumps)
    }

    pub fn mint_nft(ctx: Context<MintNFT>) -> Result<()> {
        ctx.accounts.mint_nft(&ctx.bumps)
    }

    pub fn verify_collection(ctx: Context<VerifyCollectionMint>) -> Result<()> {
        ctx.accounts.verify_collection(&ctx.bumps)
    }
}
