use anchor_lang::{prelude::*, solana_program::program::invoke, solana_program::system_instruction::transfer};
use anchor_spl::{
    token_2022::{
        spl_token_2022::{
            extension::{transfer_hook, StateWithExtensions},
            state::Mint as MintState,
        },
        Token2022,
    },
    token_interface::Mint,
};

use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{get_extra_account_metas, get_meta_list_size, ABListError, META_LIST_ACCOUNT_SEED};

/// Rewrites an existing mint's extra-metas account to the current
/// `get_extra_account_metas()` layout, reallocating it if the size changed.
/// Permissionless: the content is fully determined by `mint` and this
/// program's own fixed extra-account list, so nothing needs a signature -
/// gating on the transfer-hook authority would strand mints whose authority
/// was revoked.
#[derive(Accounts)]
pub struct ResizeMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [META_LIST_ACCOUNT_SEED, mint.key().as_ref()],
        bump,
    )]
    /// CHECK: extra metas account
    pub extra_metas_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub token_program: Program<'info, Token2022>,
}

impl ResizeMetaList<'_> {
    pub fn resize_meta_list(&mut self) -> Result<()> {
        // Confirm the mint is actually configured to use this hook program -
        // read directly from its TransferHook extension, no CPI needed.
        let configured_program_id = {
            let mint_info = self.mint.to_account_info();
            let mint_data = mint_info.data.borrow();
            let mint_state = StateWithExtensions::<MintState>::unpack(&mint_data)?;
            transfer_hook::get_program_id(&mint_state)
        };
        require!(configured_program_id == Some(crate::ID_CONST), ABListError::MintNotUsingThisHook);

        let account_info = self.extra_metas_account.to_account_info();
        let new_size = get_meta_list_size()?;

        let min_balance = Rent::get()?.minimum_balance(new_size);
        if min_balance > account_info.lamports() {
            invoke(
                &transfer(&self.payer.key(), account_info.key, min_balance - account_info.lamports()),
                &[self.payer.to_account_info(), account_info.clone(), self.system_program.to_account_info()],
            )?;
        }
        account_info.resize(new_size)?;

        let metas = get_extra_account_metas()?;
        let mut data = account_info.try_borrow_mut_data()?;
        ExtraAccountMetaList::update::<ExecuteInstruction>(&mut data, &metas)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        Ok(())
    }
}
