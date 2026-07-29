use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::group_pointer::GroupPointer;
use anchor_spl::token_interface::{
    spl_token_2022::{
        extension::{BaseStateWithExtensions, StateWithExtensions},
        state::Mint as MintState,
    },
    token_group_initialize, Mint, Token2022, TokenGroupInitialize,
};

declare_id!("2q91RT4FSHVdyuBMDiCtnZn2ETSrG4mLFZvEC3UxKfue");

#[program]
pub mod group {

    use super::*;

    pub fn test_initialize_group(ctx: Context<InitializeGroup>) -> Result<()> {
        ctx.accounts.check_mint_data()?;

        // // Token Group and Token Member extensions features not enabled yet on the Token2022 program
        // // This is temporary placeholder to update one extensions are live
        // // Initializing the "pointers" works, but you can't initialize the group/member data yet

        // let signer_seeds: &[&[&[u8]]] = &[&[b"group", &[ctx.bumps.mint_account]]];
        // token_group_initialize(
        //     CpiContext::new(
        //         ctx.accounts.token_program.to_account_info(),
        //         TokenGroupInitialize {
        //             token_program_id: ctx.accounts.token_program.to_account_info(),
        //             group: ctx.accounts.mint_account.to_account_info(),
        //             mint: ctx.accounts.mint_account.to_account_info(),
        //             mint_authority: ctx.accounts.mint_account.to_account_info(),
        //         },
        //     )
        //     .with_signer(signer_seeds),
        //     Some(ctx.accounts.payer.key()), // update_authority
        //     10,                             // max_size
        // )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeGroup<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        seeds = [b"group"],
        bump,
        payer = payer,
        mint::decimals = 2,
        mint::authority = mint_account,
        mint::freeze_authority = mint_account,
        extensions::group_pointer::authority = mint_account,
        extensions::group_pointer::group_address = mint_account,
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeGroup<'info> {
    pub fn check_mint_data(&self) -> Result<()> {
        let mint = &self.mint_account.to_account_info();
        let mint_data = mint.data.borrow();
        let mint_with_extension = StateWithExtensions::<MintState>::unpack(&mint_data)?;
        let extension_data = mint_with_extension.get_extension::<GroupPointer>()?;

        msg!("{:?}", mint_with_extension);
        msg!("{:?}", extension_data);
        Ok(())
    }
}
