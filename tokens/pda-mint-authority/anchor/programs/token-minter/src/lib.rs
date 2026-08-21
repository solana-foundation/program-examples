use anchor_lang::prelude::*;
use instructions::*;
pub mod errors;
pub mod instructions;
pub mod state;

declare_id!("3LFrPHqwk5jMrmiz48BFj6NV2k4NjobgTe1jChzx3JGD");

#[program]
pub mod token_minter {
    use super::*;

    pub fn create_token(
        ctx: Context<CreateToken>,
        token_name: String,
        token_symbol: String,
        token_uri: String,
    ) -> Result<()> {
        create::create_token(ctx, token_name, token_symbol, token_uri)
    }

    pub fn mint_token(ctx: Context<MintToken>, amount: u64) -> Result<()> {
        mint::mint_token(ctx, amount)
    }
}
