use anchor_lang::solana_program::program::invoke;
use anchor_lang::{prelude::*, solana_program::system_instruction::transfer};
use anchor_spl::token_interface::spl_token_metadata_interface::state::TokenMetadata;
use anchor_spl::{
    token_2022::{
        spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions},
        spl_token_2022::state::Mint,
        Token2022,
    },
    token_interface::{
        spl_token_metadata_interface::state::Field, token_metadata_update_field, Mint as MintAccount,
        TokenMetadataUpdateField,
    },
};

use crate::Mode;

#[derive(Accounts)]
pub struct ChangeMode<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, MintAccount>,

    pub token_program: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ChangeModeArgs {
    pub mode: Mode,
    pub threshold: u64,
}

impl ChangeMode<'_> {
    pub fn change_mode(&mut self, args: ChangeModeArgs) -> Result<()> {
        let cpi_accounts = TokenMetadataUpdateField {
            metadata: self.mint.to_account_info(),
            update_authority: self.authority.to_account_info(),
            program_id: self.token_program.to_account_info(),
        };
        let cpi_program = self.token_program.key();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token_metadata_update_field(cpi_ctx, Field::Key("AB".to_string()), args.mode.to_string())?;

        if args.mode == Mode::Mixed || self.has_threshold()? {
            let threshold = if args.mode == Mode::Mixed { args.threshold } else { 0 };

            let cpi_accounts = TokenMetadataUpdateField {
                metadata: self.mint.to_account_info(),
                update_authority: self.authority.to_account_info(),
                program_id: self.token_program.to_account_info(),
            };
            let cpi_program = self.token_program.key();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

            token_metadata_update_field(cpi_ctx, Field::Key("threshold".to_string()), threshold.to_string())?;
        }

        let data = self.mint.to_account_info().data_len();
        let min_balance = Rent::get()?.minimum_balance(data);
        if min_balance > self.mint.to_account_info().get_lamports() {
            invoke(
                &transfer(
                    &self.authority.key(),
                    &self.mint.to_account_info().key(),
                    min_balance - self.mint.to_account_info().get_lamports(),
                ),
                &[self.authority.to_account_info(), self.mint.to_account_info(), self.system_program.to_account_info()],
            )?;
        }

        Ok(())
    }

    fn has_threshold(&self) -> Result<bool> {
        let mint_info = self.mint.to_account_info();
        let mint_data = mint_info.data.borrow();
        let mint = StateWithExtensions::<Mint>::unpack(&mint_data)?;
        let metadata = mint.get_variable_len_extension::<TokenMetadata>();
        Ok(metadata.is_ok() && metadata.unwrap().additional_metadata.iter().any(|(key, _)| key == "threshold"))
    }
}
