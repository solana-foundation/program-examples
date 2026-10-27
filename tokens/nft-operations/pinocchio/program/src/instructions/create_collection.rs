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
    build_metadata_data, create_master_edition_cpi, create_metadata_cpi, AUTHORITY_SEED, MINT_SIZE, TOKEN_DECIMALS,
};

/// Creates a collection NFT: a 0-decimal mint whose authority is the program's
/// `[b"authority"]` PDA, with Metaplex metadata (marked as a sized collection)
/// and a master edition. The single token is minted to the user's ATA.
///
/// Accounts:
///   0. `[signer, writable]` user (payer)
///   1. `[signer, writable]` mint account (a fresh keypair)
///   2. `[]`                 mint authority PDA (`[b"authority"]`, also update authority)
///   3. `[writable]`         metadata account (Metaplex PDA)
///   4. `[writable]`         master edition account (Metaplex PDA)
///   5. `[writable]`         user's associated token account (the destination)
///   6. `[]`                 system program
///   7. `[]`                 token program
///   8. `[]`                 associated token program
///   9. `[]`                 token metadata program
///
/// Instruction data: none.
pub fn create_collection(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [user, mint, mint_authority, metadata, master_edition, destination, system_program, token_program, _associated_token_program, _token_metadata_program] =
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

    // Create and initialize the mint, with the PDA as mint/freeze authority.
    // Rent-exempt minimum is read from the Rent sysvar.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;
    log!("Creating mint account");
    CreateAccount { from: user, to: mint, lamports, space: MINT_SIZE as u64, owner: &pinocchio_token::ID }.invoke()?;

    log!("Initializing mint account");
    InitializeMint2::new(mint, TOKEN_DECIMALS, mint_authority.address(), Some(mint_authority.address())).invoke()?;

    // Signer seeds for the mint-authority PDA, reused by the CPIs below.
    let bump_bytes = [bump];
    let seeds = [Seed::from(AUTHORITY_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating destination token account");
    CreateIdempotent { funding_account: user, account: destination, wallet: user, mint, system_program, token_program }
        .invoke()?;

    log!("Minting collection NFT");
    MintTo::new(mint, destination, mint_authority, 1).invoke_signed(&signers)?;

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
