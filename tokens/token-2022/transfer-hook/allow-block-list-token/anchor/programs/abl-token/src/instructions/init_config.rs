use crate::{program::AblToken, ABListError, Config, CONFIG_SEED};
use anchor_lang::prelude::*;

/// Creates the program's single config and records the payer as the list
/// authority. Only the program's upgrade authority (by default, whoever
/// deployed it) may call this. Otherwise anyone could claim the config in the
/// gap between deploying the program and initializing it.
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

    /// This program's own account, which points at its ProgramData.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, AblToken>,

    /// Records the program's upgrade authority, which must be the payer.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(payer.key())
            @ ABListError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

impl InitConfig<'_> {
    pub fn init_config(&mut self, config_bump: u8) -> Result<()> {
        self.config.set_inner(Config { authority: self.payer.key(), bump: config_bump });

        Ok(())
    }
}
