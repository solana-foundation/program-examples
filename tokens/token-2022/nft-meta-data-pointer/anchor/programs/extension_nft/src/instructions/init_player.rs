pub use crate::errors::GameErrorCode;
use crate::state::player_data::PlayerData;
use crate::{constants::MAX_ENERGY, GameData};
use anchor_lang::prelude::*;

pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
    ctx.accounts.player.energy = MAX_ENERGY;
    ctx.accounts.player.last_login = Clock::get()?.unix_timestamp;
    ctx.accounts.player.authority = ctx.accounts.signer.key();
    Ok(())
}

#[derive(Accounts)]
#[instruction(level_seed: String)]
pub struct InitPlayer<'info> {
    #[account(
        init,
        payer = signer,
        space = 1000, // 8+32+x+1+8+8+8 But taking 1000 to have space to expand easily.
        seeds = [b"player".as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerData>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 1000, // 8 + 8 for anchor account discriminator and the u64. Using 1000 to have space to expand easily.
        seeds = [level_seed.as_ref()],
        bump,
    )]
    pub game_data: Account<'info, GameData>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
