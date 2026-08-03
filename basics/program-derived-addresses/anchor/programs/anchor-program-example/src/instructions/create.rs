use crate::state::PageVisits;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreatePageVisits<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        init,
        space = 8 + PageVisits::INIT_SPACE,
        payer = payer,
        seeds = [
            PageVisits::SEED_PREFIX,
            payer.key().as_ref(),
        ],
        bump,
    )]
    page_visits: Account<'info, PageVisits>,
    system_program: Program<'info, System>,
}

pub fn create_page_visits(ctx: Context<CreatePageVisits>) -> Result<()> {
    *ctx.accounts.page_visits = PageVisits { page_visits: 0, bump: ctx.bumps.page_visits };

    Ok(())
}
