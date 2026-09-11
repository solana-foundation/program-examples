use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        close_account,
        transfer,
        CloseAccount,
        Mint,
        Token,
        TokenAccount,
        Transfer
    }
};

use crate::{
    state::Fundraiser,
    FundraiserError,
    SECONDS_TO_DAYS
};

#[derive(Accounts)]
pub struct Teardown<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    pub mint_to_raise: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"fundraiser", maker.key().as_ref()],
        bump = fundraiser.bump,
        has_one = mint_to_raise,
        close = maker,
    )]
    pub fundraiser: Account<'info, Fundraiser>,
    #[account(
        mut,
        associated_token::mint = mint_to_raise,
        associated_token::authority = fundraiser,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = maker,
        associated_token::mint = mint_to_raise,
        associated_token::authority = maker,
    )]
    pub maker_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Teardown<'info> {
    pub fn teardown(&self) -> Result<()> {

        // A failed campaign can only be torn down once its duration has elapsed
        let current_time = Clock::get()?.unix_timestamp;

        require!(
            self.fundraiser.duration <= ((current_time - self.fundraiser.time_started) / SECONDS_TO_DAYS) as u16,
            FundraiserError::FundraiserNotEnded
        );

        // Every recorded contribution must have been refunded first, so any
        // balance left in the vault can only be stray direct deposits that
        // belong to the maker
        require!(
            self.fundraiser.current_amount == 0,
            FundraiserError::UnrefundedContributions
        );

        // Sweep the leftover vault balance to the maker
        let cpi_program = self.token_program.key();

        // Transfer the funds from the vault to the maker
        let cpi_accounts = Transfer {
            from: self.vault.to_account_info(),
            to: self.maker_ata.to_account_info(),
            authority: self.fundraiser.to_account_info(),
        };

        // Signer seeds to sign the CPI on behalf of the fundraiser account
        let signer_seeds: [&[&[u8]]; 1] = [&[
            b"fundraiser".as_ref(),
            self.maker.to_account_info().key.as_ref(),
            &[self.fundraiser.bump],
        ]];

        // CPI context with signer since the fundraiser account is a PDA
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, &signer_seeds);

        // Transfer the funds from the vault to the maker
        transfer(cpi_ctx, self.vault.amount)?;

        // Close the vault and recover its rent to the maker
        let close_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.maker.to_account_info(),
            authority: self.fundraiser.to_account_info(),
        };

        close_account(CpiContext::new_with_signer(cpi_program, close_accounts, &signer_seeds), None)?;

        Ok(())
    }
}
