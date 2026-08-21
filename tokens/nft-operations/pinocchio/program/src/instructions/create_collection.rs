use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::{InitializeMint2, MintTo};

use crate::instructions::{
    build_metadata_data, create_master_edition_cpi, create_metadata_cpi, AUTHORITY_SEED, COLLECTION_AUTHORITY_LEN,
    COLLECTION_AUTHORITY_SEED, MINT_SIZE, TOKEN_DECIMALS,
};

/// Creates a collection NFT: a 0-decimal mint whose authority is the program's
/// `[b"authority"]` PDA, with Metaplex metadata (marked as a sized collection)
/// and a master edition. The single token is minted to the user's ATA. Also
/// creates a `collection_authority` account recording `user` as this
/// collection's creator, so `verify_collection` can later confirm only they
/// may verify members of it.
///
/// Accounts:
///   0. `[signer, writable]` user (payer)
///   1. `[signer, writable]` mint account (a fresh keypair)
///   2. `[]`                 mint authority PDA (`[b"authority"]`, also update authority)
///   3. `[writable]`         collection authority PDA (`[b"collection_authority", mint]`)
///   4. `[writable]`         metadata account (Metaplex PDA)
///   5. `[writable]`         master edition account (Metaplex PDA)
///   6. `[writable]`         user's associated token account (the destination)
///   7. `[]`                 system program
///   8. `[]`                 token program
///   9. `[]`                 associated token program
///   10. `[]`                token metadata program
///
/// Instruction data: none.
pub fn create_collection(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [user, mint, mint_authority, collection_authority, metadata, master_edition, destination, system_program, token_program, _associated_token_program, _token_metadata_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !user.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive the canonical mint-authority PDA and bump on-chain (as the Anchor
    // example does) instead of trusting a client-supplied bump, and confirm the
    // supplied account matches it.
    let (pda, bump) = Address::find_program_address(&[AUTHORITY_SEED], program_id);
    if mint_authority.address() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let (collection_authority_pda, collection_authority_bump) =
        Address::find_program_address(&[COLLECTION_AUTHORITY_SEED, mint.address().as_ref()], program_id);
    if collection_authority.address() != &collection_authority_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create and initialize the mint, with the PDA as mint/freeze authority.
    // Rent-exempt minimum is read from the Rent sysvar.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;
    log!("Creating mint account");
    CreateAccount { from: user, to: mint, lamports, space: MINT_SIZE as u64, owner: &pinocchio_token::ID }.invoke()?;

    log!("Creating collection authority account");
    let collection_authority_bump_bytes = [collection_authority_bump];
    let collection_authority_seeds = [
        Seed::from(COLLECTION_AUTHORITY_SEED),
        Seed::from(mint.address().as_ref()),
        Seed::from(&collection_authority_bump_bytes),
    ];
    let collection_authority_signers = [Signer::from(&collection_authority_seeds)];
    let collection_authority_lamports = rent.try_minimum_balance(COLLECTION_AUTHORITY_LEN)?;
    CreateAccount {
        from: user,
        to: collection_authority,
        lamports: collection_authority_lamports,
        space: COLLECTION_AUTHORITY_LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&collection_authority_signers)?;
    collection_authority.try_borrow_mut()?.copy_from_slice(user.address().as_ref());

    log!("Initializing mint account");
    InitializeMint2 {
        mint,
        decimals: TOKEN_DECIMALS,
        mint_authority: mint_authority.address(),
        freeze_authority: Some(mint_authority.address()),
    }
    .invoke()?;

    // Signer seeds for the mint-authority PDA, reused by the CPIs below.
    let bump_bytes = [bump];
    let seeds = [Seed::from(AUTHORITY_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating destination token account");
    CreateIdempotent { funding_account: user, account: destination, wallet: user, mint, system_program, token_program }
        .invoke()?;

    log!("Minting collection NFT");
    MintTo { mint, account: destination, mint_authority, amount: 1, multisig_signers: &[] as &[&AccountView] }
        .invoke_signed(&signers)?;

    log!("Creating metadata account");
    let metadata_data =
        build_metadata_data("DummyCollection", "DC", "", mint_authority.address().as_array(), None, true);
    create_metadata_cpi(metadata, mint, mint_authority, user, system_program, &metadata_data, &signers)?;

    log!("Creating master edition account");
    create_master_edition_cpi(
        master_edition,
        mint,
        mint_authority,
        user,
        metadata,
        token_program,
        system_program,
        &signers,
    )?;

    log!("Collection NFT created successfully");
    Ok(())
}
