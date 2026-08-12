use anchor_lang::{prelude::*, solana_program::program::invoke, solana_program::system_instruction::transfer};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{transfer_hook_update, Mint, TransferHookUpdate},
};

use spl_tlv_account_resolution::state::ExtraAccountMetaList;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{get_extra_account_metas, get_meta_list_size, META_LIST_ACCOUNT_SEED};

/// Rewrites an existing mint's extra-metas account to the current
/// `get_extra_account_metas()` layout, reallocating it if the size changed.
///
/// This exists because `extra_metas_account` is a fixed-size PDA created once
/// by `init_mint`/`attach_to_mint`: if the program's extra-account list is
/// ever extended (e.g. to add the source-wallet check), mints that were set
/// up under the old layout are left with a stale, undersized account and
/// their transfers start failing the hook's account-count check. Any mint
/// authority can call this to bring an existing mint's extra-metas account
/// back in sync after such an upgrade.
#[derive(Accounts)]
pub struct ResizeMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, mint::token_program = token_program)]
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
        // Re-setting the transfer hook to itself has no effect on the mint,
        // but the CPI only succeeds if `payer` is the mint's current
        // transfer-hook authority - the same check `attach_to_mint` relies
        // on, reused here so this instruction can't be called by anyone
        // other than whoever is already trusted to configure this mint's hook.
        let tx_hook_accs = TransferHookUpdate {
            token_program_id: self.token_program.to_account_info(),
            mint: self.mint.to_account_info(),
            authority: self.payer.to_account_info(),
        };
        let ctx = CpiContext::new(self.token_program.key(), tx_hook_accs);
        transfer_hook_update(ctx, Some(crate::ID_CONST))?;

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
