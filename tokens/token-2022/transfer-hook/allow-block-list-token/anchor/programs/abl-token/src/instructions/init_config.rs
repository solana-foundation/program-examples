use crate::{Config, CONFIG_SEED};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,

    pub system_program: Program<'info, System>,
}

impl InitConfig<'_> {
    pub fn init_config(&mut self, config_bump: u8) -> Result<()> {
        self.config.set_inner(Config { authority: self.payer.key(), bump: config_bump });

        Ok(())
    }
}
