use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_interface::{Mint, Token2022};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::instruction::emit;

#[derive(Accounts)]
pub struct Emit<'info> {
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
}

// Invoke the emit instruction from spl_token_metadata_interface directly
// There is not an anchor CpiContext for this instruction
pub fn process_emit(ctx: Context<Emit>) -> Result<()> {
    invoke(
        &emit(
            &ctx.accounts.token_program.key(), // token program id
            &ctx.accounts.mint_account.key(),  // "metadata" account
            None,
            None,
        ),
        &[
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.mint_account.to_account_info(),
        ],
    )?;
    Ok(())
}
