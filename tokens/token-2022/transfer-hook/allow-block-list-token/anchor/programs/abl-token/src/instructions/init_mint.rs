use anchor_lang::{prelude::*, solana_program::program::invoke, solana_program::system_instruction::transfer};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        spl_token_metadata_interface::state::Field, token_metadata_initialize, token_metadata_update_field, Mint,
        TokenMetadataInitialize, TokenMetadataUpdateField,
    },
};

use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{get_extra_account_metas, get_meta_list_size, Mode, META_LIST_ACCOUNT_SEED};

#[derive(Accounts)]
#[instruction(args: InitMintArgs)]
pub struct InitMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        mint::token_program = token_program,
        mint::decimals = args.decimals,
        mint::authority = payer.key(),
        mint::freeze_authority = args.freeze_authority,
        extensions::permanent_delegate::delegate = args.permanent_delegate,
        extensions::transfer_hook::authority = args.transfer_hook_authority,
        extensions::transfer_hook::program_id = crate::id(),
        extensions::metadata_pointer::authority = payer.key(),
        extensions::metadata_pointer::metadata_address = mint.key(),
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        space = get_meta_list_size()?,
        seeds = [META_LIST_ACCOUNT_SEED, mint.key().as_ref()],
        bump,
        payer = payer,
    )]
    /// CHECK: extra metas account
    pub extra_metas_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token2022>,
}

impl InitMint<'_> {
    pub fn init_mint(&mut self, args: InitMintArgs) -> Result<()> {
        let cpi_accounts = TokenMetadataInitialize {
            program_id: self.token_program.to_account_info(),
            mint: self.mint.to_account_info(),
            metadata: self.mint.to_account_info(), // metadata account is the mint, since data is stored in mint
            mint_authority: self.payer.to_account_info(),
            update_authority: self.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(self.token_program.key(), cpi_accounts);
        token_metadata_initialize(cpi_ctx, args.name, args.symbol, args.uri)?;

        let cpi_accounts = TokenMetadataUpdateField {
            metadata: self.mint.to_account_info(),
            update_authority: self.payer.to_account_info(),
            program_id: self.token_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.token_program.key(), cpi_accounts);

        token_metadata_update_field(cpi_ctx, Field::Key("AB".to_string()), args.mode.to_string())?;

        if args.mode == Mode::Mixed {
            let cpi_accounts = TokenMetadataUpdateField {
                metadata: self.mint.to_account_info(),
                update_authority: self.payer.to_account_info(),
                program_id: self.token_program.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(self.token_program.key(), cpi_accounts);

            token_metadata_update_field(cpi_ctx, Field::Key("threshold".to_string()), args.threshold.to_string())?;
        }

        let data = self.mint.to_account_info().data_len();
        let min_balance = Rent::get()?.minimum_balance(data);
        if min_balance > self.mint.to_account_info().get_lamports() {
            invoke(
                &transfer(
                    &self.payer.key(),
                    &self.mint.to_account_info().key(),
                    min_balance - self.mint.to_account_info().get_lamports(),
                ),
                &[self.payer.to_account_info(), self.mint.to_account_info(), self.system_program.to_account_info()],
            )?;
        }

        // initialize the extra metas account
        let extra_metas_account = &self.extra_metas_account;
        let metas = get_extra_account_metas()?;
        let mut data = extra_metas_account.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitMintArgs {
    pub decimals: u8,
    pub mint_authority: Pubkey,
    pub freeze_authority: Pubkey,
    pub permanent_delegate: Pubkey,
    pub transfer_hook_authority: Pubkey,
    pub mode: Mode,
    pub threshold: u64,
    pub name: String,
    pub symbol: String,
    pub uri: String,
}
