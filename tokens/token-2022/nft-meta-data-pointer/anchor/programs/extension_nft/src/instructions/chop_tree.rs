pub use crate::errors::GameErrorCode;
pub use crate::state::game_data::GameData;
use crate::{state::player_data::PlayerData, NftAuthority};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Token2022};
use session_keys::{Session, SessionToken};
use anchor_lang::solana_program::program::invoke_signed;

pub fn chop_tree(ctx: Context<ChopTree>, counter: u16, amount: u64) -> Result<()> {
    let account: &mut ChopTree<'_> = ctx.accounts;
    account.player.update_energy()?;
    account.player.print()?;

    if account.player.energy < amount {
        return err!(GameErrorCode::NotEnoughEnergy);
    }

    account.player.last_id = counter;
    account.player.chop_tree(amount)?;
    account.game_data.on_tree_chopped(amount)?;

    msg!(
        "You chopped a tree and got 1 wood. You have {} wood and {} energy left.",
        ctx.accounts.player.wood,
        ctx.accounts.player.energy
    );

    // We use a PDA as a mint authority for the metadata account because we want to be able to update the NFT from
    // the program.
    let seeds = b"nft_authority";
    let bump = ctx.bumps.nft_authority;
    let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

    // Update the metadata account with an additional metadata field in this case the player level
    invoke_signed(
        &anchor_spl::token_2022_extensions::spl_token_metadata_interface::instruction::update_field(
            &anchor_spl::token_2022::spl_token_2022::id(),
            ctx.accounts.mint.to_account_info().key,
            ctx.accounts.nft_authority.to_account_info().key,
            anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::Field::Key("wood".to_string()),
            ctx.accounts.player.wood.to_string(),
        ),
        &[
            ctx.accounts.mint.to_account_info().clone(),
            ctx.accounts.nft_authority.to_account_info().clone(),
        ],
        signer,
    )?;

    Ok(())
}

#[derive(Accounts, Session)]
#[instruction(level_seed: String)]
pub struct ChopTree<'info> {
    #[session(
        // The ephemeral key pair signing the transaction
        signer = signer,
        // The authority of the user account which must have created the session
        authority = player.authority.key()
    )]
    // Session Tokens are passed as optional accounts
    pub session_token: Option<Account<'info, SessionToken>>,

    // There is one PlayerData account
    #[account(
        mut,
        seeds = [b"player".as_ref(), player.authority.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerData>,

    // There can be multiple levels the seed for the level is passed in the instruction
    // First player starting a new level will pay for the account in the current setup
    #[account(
        init_if_needed,
        payer = signer,
        space = 1000,
        seeds = [level_seed.as_ref()],
        bump,
    )]
    pub game_data: Account<'info, GameData>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Make sure the ata to the mint is actually owned by the signer
    #[account(mut)]
    pub mint: AccountInfo<'info>,
    #[account(  
        init_if_needed,
        seeds = [b"nft_authority".as_ref()],
        bump,
        space = 8,
        payer = signer,
    )]
    pub nft_authority: Account<'info, NftAuthority>,
    pub token_program: Program<'info, Token2022>,
}
