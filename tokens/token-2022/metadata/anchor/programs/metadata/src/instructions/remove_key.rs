use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token_interface::{Mint, Token2022};
use anchor_spl::token_2022_extensions::spl_token_metadata_interface::instruction::remove_key;

#[derive(Accounts)]
pub struct RemoveKey<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        mut,
        extensions::metadata_pointer::metadata_address = mint_account,
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

// Invoke the remove_key instruction from spl_token_metadata_interface directly
// There is not an anchor CpiContext for this instruction
pub fn process_remove_key(ctx: Context<RemoveKey>, key: String) -> Result<()> {
    invoke(
        &remove_key(
            &ctx.accounts.token_program.key(),    // token program id
            &ctx.accounts.mint_account.key(),     // "metadata" account
            &ctx.accounts.update_authority.key(), // update authority
            key,                                  // key to remove
            true, // idempotent flag, if true transaction will not fail if key does not exist
        ),
        &[
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.mint_account.to_account_info(),
            ctx.accounts.update_authority.to_account_info(),
        ],
    )?;
    Ok(())
}
