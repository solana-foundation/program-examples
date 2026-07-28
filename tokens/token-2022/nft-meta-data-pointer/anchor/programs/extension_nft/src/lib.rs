pub use crate::errors::GameErrorCode;
pub use anchor_lang::prelude::*;
pub use session_keys::{session_auth_or, Session, SessionError};
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
use instructions::*;

declare_id!("4nSA2i5bEiBWLLDuZfqTYKwTAwakLEbW2KJXH9cZtDU3");

#[program]
pub mod extension_nft {
    use super::*;

    pub fn init_player(ctx: Context<InitPlayer>, _level_seed: String) -> Result<()> {
        init_player::init_player(ctx)
    }

    // This function lets the player chop a tree and get 1 wood. The session_auth_or macro
    // lets the player either use their session token or their main wallet. (The counter is only
    // there so that the player can do multiple transactions in the same block. Without it multiple transactions
    // in the same block would result in the same signature and therefore fail.)
    #[session_auth_or(
        ctx.accounts.player.authority.key() == ctx.accounts.signer.key(),
        GameErrorCode::WrongAuthority
    )]
    pub fn chop_tree(ctx: Context<ChopTree>, _level_seed: String, counter: u16) -> Result<()> {
        chop_tree::chop_tree(ctx, counter, 1)
    }

    pub fn mint_nft(ctx: Context<MintNft>) -> Result<()> {
        mint_nft::mint_nft(ctx)
    }
}
