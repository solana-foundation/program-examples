use {
    anchor_lang::{
        prelude::*,
        system_program::{create_account, CreateAccount},
    },
    anchor_spl::token_interface::Mint,
    spl_tlv_account_resolution::{
        account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
    },
    spl_transfer_hook_interface::instruction::ExecuteInstruction,
};

#[derive(Accounts)]
pub struct InitializeExtraAccountMetas<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account()]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: extra accoumt metas list
    #[account(
        mut,
        seeds = [b"extra-account-metas", token_mint.key().as_ref()],
        bump,
    )]
    pub extra_account_metas_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> InitializeExtraAccountMetas<'info> {
    pub fn initialize_extra_account_metas_list(
        &self,
        bumps: InitializeExtraAccountMetasBumps,
    ) -> Result<()> {
        // .map_err() needed because spl-tlv-account-resolution uses solana-program-error 2.x
        // while anchor-lang 1.0 uses 3.x, structurally identical but different semver types
        let account_metas = vec![
            // 5 - wallet (sender) config account
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::AccountKey { index: 3 }, // sender index
                ],
                false, // is_signer
                false, // is_writable
            ).map_err(|_| ProgramError::InvalidArgument)?,
        ];

        // calculate account size
        // unwrap is safe for known-good input (count of metas we just created)
        let account_size = ExtraAccountMetaList::size_of(account_metas.len()).unwrap() as u64;

        // calculate minimum required lamports
        let lamports = Rent::get()?.minimum_balance(account_size as usize);

        let mint = self.token_mint.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            mint.as_ref(),
            &[bumps.extra_account_metas_list],
        ]];

        create_account(
            CpiContext::new(
                self.system_program.key(),
                CreateAccount {
                    from: self.payer.to_account_info(),
                    to: self.extra_account_metas_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            account_size,
            &crate::ID,
        )?;

        // Initialize the account data to store the list of ExtraAccountMetas
        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut self.extra_account_metas_list.try_borrow_mut_data()?,
            &account_metas,
        ).map_err(|_| ProgramError::InvalidAccountData)?;

        Ok(())
    }
}
