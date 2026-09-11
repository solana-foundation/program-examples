use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};

// NOTE: this example does not restrict who may call it. A real rent vault
// needs an authority check: a `has_one` against an admin recorded at
// initialization, seeds that bind the vault to one funder, or a per-caller
// limit. A bare `authority: Signer` alone is not enough, since any keypair
// can sign for itself.
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
