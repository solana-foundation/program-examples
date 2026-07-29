use {
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        msg,
        program::invoke,
    },
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::instruction as token_instruction,
};

pub fn mint_nft(accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let mint_account = next_account_info(accounts_iter)?;
    let metadata_account = next_account_info(accounts_iter)?;
    let edition_account = next_account_info(accounts_iter)?;
    let mint_authority = next_account_info(accounts_iter)?;
    let associated_token_account = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let _rent = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let associated_token_program = next_account_info(accounts_iter)?;
    let token_metadata_program = next_account_info(accounts_iter)?;

    if associated_token_account.lamports() == 0 {
        msg!("Creating associated token account...");
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                payer.key,
                mint_account.key,
                token_program.key,
            ),
            &[
                mint_account.clone(),
                associated_token_account.clone(),
                payer.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;
    } else {
        msg!("Associated token account exists.");
    }
    msg!("Associated Token Address: {}", associated_token_account.key);

    // Mint the NFT to the user's wallet
    //
    msg!("Minting NFT to associated token account...");
    invoke(
        &token_instruction::mint_to(
            token_program.key,
            mint_account.key,
            associated_token_account.key,
            mint_authority.key,
            &[mint_authority.key],
            1,
        )?,
        &[mint_account.clone(), mint_authority.clone(), associated_token_account.clone(), token_program.clone()],
    )?;

    // We can make this a Limited Edition NFT through Metaplex,
    //      which will disable minting by setting the Mint & Freeze Authorities to the
    //      Edition Account.
    //
    msg!("Creating edition account...");
    msg!("Edition account address: {}", edition_account.key);
    invoke(
        &crate::mpl_util::create_master_edition_v3(
            edition_account.key,
            mint_account.key,
            mint_authority.key,
            mint_authority.key,
            payer.key,
            metadata_account.key,
            token_program.key,
            system_program.key,
            1,
        ),
        &[
            edition_account.clone(),
            mint_account.clone(),
            mint_authority.clone(),
            mint_authority.clone(),
            payer.clone(),
            metadata_account.clone(),
            token_program.clone(),
            system_program.clone(),
            token_metadata_program.clone(),
        ],
    )?;

    // If we don't use Metaplex Editions, we must disable minting manually
    //
    // -------------------------------------------------------------------
    // msg!("Disabling future minting of this NFT...");
    // invoke(
    //     &token_instruction::set_authority(
    //         &token_program.key,
    //         &mint_account.key,
    //         None,
    //         token_instruction::AuthorityType::MintTokens,
    //         &mint_authority.key,
    //         &[&mint_authority.key],
    //     )?,
    //     &[
    //         mint_account.clone(),
    //         mint_authority.clone(),
    //         token_program.clone(),
    //     ],
    // )?;
    // invoke(
    //     &token_instruction::set_authority(
    //         &token_program.key,
    //         &mint_account.key,
    //         None,
    //         token_instruction::AuthorityType::FreezeAccount,
    //         &mint_authority.key,
    //         &[&mint_authority.key],
    //     )?,
    //     &[
    //         mint_account.clone(),
    //         mint_authority.clone(),
    //         token_program.clone(),
    //     ],
    // )?;

    msg!("NFT minted successfully.");

    Ok(())
}
