use anchor_lang::prelude::*;

use crate::{StakeConfig, UserAccount, ANCHOR_DISCRIMINATOR};

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"config", config.admin.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StakeConfig>,

    /// Scoped to the pool as well as the user: the stake cap and the points
    /// total belong to one pool, so a user hitting the cap in one must not
    /// affect their standing in another.
    #[account(
        init,
        payer = user,
        space = ANCHOR_DISCRIMINATOR + UserAccount::INIT_SPACE,
        seeds = [b"user", config.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeUser<'info> {
    pub fn initialize_user(&mut self, bumps: &InitializeUserBumps) -> Result<()> {
        self.user_account.set_inner(UserAccount { points_earned: 0, amount_staked: 0, bump: bumps.user_account });

        Ok(())
    }
}
