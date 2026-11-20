use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};

#[derive(Accounts)]
pub struct CreateNewAccount<'info> {
    #[account(mut)]
    new_account: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"rent_vault",
        ],
        bump,
    )]
    rent_vault: SystemAccount<'info>,
    system_program: Program<'info, System>,
}

/// SECURITY NOTE: This example omits a caller authority check for brevity.
/// Anyone who calls `create_new_account` can spend lamports from the `rent_vault` PDA
/// to fund arbitrary accounts. In production, restrict this instruction by comparing
/// an authorized signer against a stored admin/funder pubkey (`has_one` / `constraint`)
/// in addition to general account checks (see `basics/checking-accounts` for account validation only).
pub fn create_new_account(ctx: Context<CreateNewAccount>) -> Result<()> {
    // PDA signer seeds
    let signer_seeds: &[&[&[u8]]] = &[&[b"rent_vault", &[ctx.bumps.rent_vault]]];

    // The minimum lamports for rent exemption
    let lamports = (Rent::get()?).minimum_balance(0);

    // Create the new account, transferring lamports from the rent vault to the new account
    create_account(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.rent_vault.to_account_info(), // From pubkey
                to: ctx.accounts.new_account.to_account_info(),  // To pubkey
            },
        )
        .with_signer(signer_seeds),
        lamports,                           // Lamports
        0,                                  // Space
        &ctx.accounts.system_program.key(), // Owner Program
    )?;
    Ok(())
}
