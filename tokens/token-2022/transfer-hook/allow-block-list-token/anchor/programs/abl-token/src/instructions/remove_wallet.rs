use anchor_lang::prelude::*;

use crate::{ABWallet, Config, AB_WALLET_SEED, CONFIG_SEED};

#[derive(Accounts)]
pub struct RemoveWallet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Box<Account<'info, Config>>,

    pub wallet: SystemAccount<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [AB_WALLET_SEED, wallet.key().as_ref()],
        bump,
    )]
    pub ab_wallet: Account<'info, ABWallet>,

    pub system_program: Program<'info, System>,
}

impl RemoveWallet<'_> {
    pub fn remove_wallet(&mut self) -> Result<()> {
        Ok(())
    }
}
