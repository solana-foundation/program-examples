pub use crate::errors::GameErrorCode;
pub use crate::state::game_data::GameData;
use anchor_lang::{ prelude::*, system_program };
use anchor_spl::{
    associated_token::{ self, AssociatedToken },
    token_2022,
    token_interface::{ spl_token_2022::instruction::AuthorityType, Token2022 },
};
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::token_2022::spl_token_2022::{extension::ExtensionType, state::Mint};

pub fn mint_nft(ctx: Context<MintNft>) -> Result<()> {
    msg!("Mint nft with meta data extension and additional meta data");

    let space = match
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer])
    {
        Ok(space) => space,
        Err(_) => {
            return err!(GameErrorCode::InvalidMintAccountSpace);
        }
    };

    // This is the space required for the metadata account.
    // We put the meta data into the mint account at the end so we
    // don't need to create and additional account.
    let meta_data_space = 250;

    let lamports_required = Rent::get()?.minimum_balance(space + meta_data_space);

    msg!(
        "Create Mint and metadata account size and cost: {} lamports: {}",
        space as u64,
        lamports_required
    );

    system_program::create_account(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            system_program::CreateAccount {
                from: ctx.accounts.signer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            }
        ),
        lamports_required,
        space as u64,
        &ctx.accounts.token_program.key()
    )?;

    // Assign the mint to the token program
    system_program::assign(
        CpiContext::new(ctx.accounts.token_program.key(), system_program::Assign {
            account_to_assign: ctx.accounts.mint.to_account_info(),
        }),
        &token_2022::ID
    )?;

    // Initialize the metadata pointer (Need to do this before initializing the mint)
    let init_meta_data_pointer_ix = match
        anchor_spl::token_2022::spl_token_2022::extension::metadata_pointer::instruction::initialize(
            &Token2022::id(),
            &ctx.accounts.mint.key(),
            Some(ctx.accounts.nft_authority.key()),
            Some(ctx.accounts.mint.key())
        )
    {
        Ok(ix) => ix,
        Err(_) => {
            return err!(GameErrorCode::CantInitializeMetadataPointer);
        }
    };

    invoke(
        &init_meta_data_pointer_ix,
        &[ctx.accounts.mint.to_account_info(), ctx.accounts.nft_authority.to_account_info()]
    )?;

    // Initialize the mint cpi
    let mint_cpi_ix = CpiContext::new(
        ctx.accounts.token_program.key(),
        token_2022::InitializeMint2 {
            mint: ctx.accounts.mint.to_account_info(),
        }
    );

    token_2022::initialize_mint2(mint_cpi_ix, 0, &ctx.accounts.nft_authority.key(), None).unwrap();

    // We use a PDA as a mint authority for the metadata account because
    // we want to be able to update the NFT from the program.
    let seeds = b"nft_authority";
    let bump = ctx.bumps.nft_authority;
    let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

    msg!("Init metadata {0}", ctx.accounts.nft_authority.to_account_info().key);

    // Init the metadata account
    let init_token_meta_data_ix = &anchor_spl::token_2022_extensions::spl_token_metadata_interface::instruction::initialize(
        &anchor_spl::token_2022::spl_token_2022::id(),
        ctx.accounts.mint.key,
        ctx.accounts.nft_authority.to_account_info().key,
        ctx.accounts.mint.key,
        ctx.accounts.nft_authority.to_account_info().key,
        "Beaver".to_string(),
        "BVA".to_string(),
        "https://arweave.net/MHK3Iopy0GgvDoM7LkkiAdg7pQqExuuWvedApCnzfj0".to_string()
    );

    invoke_signed(
        init_token_meta_data_ix,
        &[
            ctx.accounts.mint.to_account_info().clone(),
            ctx.accounts.nft_authority.to_account_info().clone(),
        ],
        signer
    )?;

    // Update the metadata account with an additional metadata field in this case the player level
    invoke_signed(
        &anchor_spl::token_2022_extensions::spl_token_metadata_interface::instruction::update_field(
            &anchor_spl::token_2022::spl_token_2022::id(),
            ctx.accounts.mint.key,
            ctx.accounts.nft_authority.to_account_info().key,
            anchor_spl::token_2022_extensions::spl_token_metadata_interface::state::Field::Key("level".to_string()),
            "1".to_string()
        ),
        &[
            ctx.accounts.mint.to_account_info().clone(),
            ctx.accounts.nft_authority.to_account_info().clone(),
        ],
        signer
    )?;

    // Create the associated token account
    associated_token::create(
        CpiContext::new(
            ctx.accounts.associated_token_program.key(),
            associated_token::Create {
                payer: ctx.accounts.signer.to_account_info(),
                associated_token: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            }
        )
    )?;

    // Mint one token to the associated token account of the player
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.nft_authority.to_account_info(),
            },
            signer
        ),
        1
    )?;

    // Freeze the mint authority so no more tokens can be minted to make it an NFT
    token_2022::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token_2022::SetAuthority {
                current_authority: ctx.accounts.nft_authority.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
            signer
        ),
        AuthorityType::MintTokens,
        None
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct MintNft<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    /// CHECK: We will create this one for the user
    #[account(mut)]
    pub token_account: AccountInfo<'info>,
    #[account(mut)]
    pub mint: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    #[account(init_if_needed, seeds = [b"nft_authority".as_ref()], bump, space = 8, payer = signer)]
    pub nft_authority: Account<'info, NftAuthority>,
}

#[account]
pub struct NftAuthority {}
