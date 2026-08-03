use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};

declare_id!("ARVNCsYKDQsCLHbwUTJLpFXVrJdjhWZStyzvxmKe2xHi");

#[program]
pub mod create_system_account {
    use super::*;

    pub fn create_system_account(ctx: Context<CreateSystemAccount>, address_data: AddressData) -> Result<()> {
        msg!("Program invoked. Creating a system account...");
        msg!("  New public key will be: {}", &ctx.accounts.new_account.key().to_string());

        // Determine the necessary minimum rent by calculating the account's size
        let account_span = anchor_lang::prelude::borsh::to_vec(&address_data)?.len();
        let lamports_required = (Rent::get()?).minimum_balance(account_span);

        msg!("Account span: {}", &account_span);
        msg!("Lamports required: {}", &lamports_required);

        create_account(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),     // From pubkey
                    to: ctx.accounts.new_account.to_account_info(), // To pubkey
                },
            ),
            lamports_required,                  // Lamports
            account_span as u64,                // Space
            &ctx.accounts.system_program.key(), // Owner Program
        )?;

        msg!("Account created succesfully.");
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub struct AddressData {
    name: String,
    address: String,
}

#[derive(Accounts)]
pub struct CreateSystemAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub new_account: Signer<'info>,
    pub system_program: Program<'info, System>,
}
