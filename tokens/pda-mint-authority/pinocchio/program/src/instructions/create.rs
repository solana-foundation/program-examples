use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeMint2;

use crate::instructions::{CreateTokenArgs, MINT_SIZE, TOKEN_DECIMALS, TOKEN_METADATA_PROGRAM_ID};
use crate::state::{MintAuthorityPda, MintConfig};

/// Discriminator of the Metaplex `CreateMetadataAccountV3` instruction (variant
/// 33 of the Token Metadata program's instruction enum).
const CREATE_METADATA_ACCOUNT_V3: u8 = 33;

/// Creates a new SPL Token mint (with 0 decimals, the NFT standard) whose mint
/// authority is the program's mint-authority PDA, and attaches an on-chain
/// Metaplex metadata account to it (name, symbol, URI).
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority PDA (also the metadata update authority)
///   2. `[writable]`         mint config PDA (created here; records the payer)
///   3. `[writable]`         metadata account (the Metaplex metadata PDA)
///   4. `[signer, writable]` payer (funds the new accounts)
///   5. `[]`                 system program
///   6. `[]`                 token program
///   7. `[]`                 token metadata program
///
/// Instruction data: Borsh `[name: string, symbol: string, uri: string]`.
///
/// The mint authority is the program-derived address, so the metadata CPI (which
/// requires the mint authority to sign) is authorized with the PDA's seeds via
/// `invoke_signed` rather than a wallet signature.
pub fn create_token(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // `token_program` and `token_metadata_program` are unused directly, but must
    // be supplied so they are present in the transaction for the CPIs below.
    let [mint_account, mint_authority, mint_config, metadata_account, payer, system_program, _token_program, _token_metadata_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let args = CreateTokenArgs::parse(data)?;

    // Recover the PDA bump recorded by `init` and confirm the supplied account is
    // the mint-authority PDA. The canonical bump is already known, so derive the
    // address directly with `create_program_address` rather than searching for it
    // with `find_program_address`.
    let bump = MintAuthorityPda::deserialize(&mint_authority.try_borrow()?)?.bump;
    let pda = Address::create_program_address(&[MintAuthorityPda::SEED_PREFIX, &[bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if mint_authority.address() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Confirm the supplied account is the mint-config PDA bound to this mint.
    let (mint_config_pda, mint_config_bump) =
        Address::find_program_address(&[MintConfig::SEED_PREFIX, mint_account.address().as_array()], program_id);
    if mint_config.address() != &mint_config_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Fund the mint account with enough lamports to stay rent-exempt, read from
    // the Rent sysvar.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;

    log!("Creating mint account");
    CreateAccount { from: payer, to: mint_account, lamports, space: MINT_SIZE as u64, owner: &pinocchio_token::ID }
        .invoke()?;

    log!("Initializing mint account");
    InitializeMint2 {
        mint: mint_account,
        decimals: TOKEN_DECIMALS,
        mint_authority: mint_authority.address(),
        freeze_authority: Some(mint_authority.address()),
    }
    .invoke()?;

    log!("Creating metadata account");
    let metadata_data = build_metadata_data(&args);
    let metadata_accounts = [
        InstructionAccount::writable(metadata_account.address()),
        InstructionAccount::readonly(mint_account.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::writable_signer(payer.address()),
        // Update authority — recorded only, not required to sign for V3.
        InstructionAccount::readonly(mint_authority.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let instruction =
        InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &metadata_accounts, data: &metadata_data };

    // Sign for the mint-authority PDA.
    let bump_bytes = [bump];
    let seeds = [Seed::from(MintAuthorityPda::SEED_PREFIX), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    invoke_signed(
        &instruction,
        &[*metadata_account, *mint_account, *mint_authority, *payer, *mint_authority, *system_program],
        &signers,
    )?;

    // Records who is allowed to call `mint_to`, since the mint authority PDA
    // itself signs unconditionally for whoever calls it.
    log!("Creating mint config account");
    let config_lamports = rent.try_minimum_balance(MintConfig::ACCOUNT_SPACE)?;
    let bump_bytes = [mint_config_bump];
    let seeds =
        [Seed::from(MintConfig::SEED_PREFIX), Seed::from(mint_account.address().as_ref()), Seed::from(&bump_bytes)];
    CreateAccount {
        from: payer,
        to: mint_config,
        lamports: config_lamports,
        space: MintConfig::ACCOUNT_SPACE as u64,
        owner: program_id,
    }
    .invoke_signed(&[Signer::from(&seeds)])?;
    MintConfig { admin: *payer.address() }.serialize(&mut mint_config.try_borrow_mut()?)?;

    log!("Token mint created successfully");
    Ok(())
}

/// Serializes the data for a Metaplex `CreateMetadataAccountV3` instruction.
///
/// Layout: `[33] DataV2 is_mutable:bool collection_details:Option`, where
/// `DataV2` is `name:string symbol:string uri:string seller_fee:u16
/// creators:Option collection:Option uses:Option`. Mirrors the values used by
/// the `anchor` and `native` examples (no royalties, no creators, immutable).
fn build_metadata_data(args: &CreateTokenArgs) -> Vec<u8> {
    let mut data = Vec::new();
    data.push(CREATE_METADATA_ACCOUNT_V3);

    // DataV2
    push_borsh_string(&mut data, args.name);
    push_borsh_string(&mut data, args.symbol);
    push_borsh_string(&mut data, args.uri);
    data.extend_from_slice(&0u16.to_le_bytes()); // seller_fee_basis_points
    data.push(0); // creators: None
    data.push(0); // collection: None
    data.push(0); // uses: None

    data.push(0); // is_mutable: false
    data.push(0); // collection_details: None

    data
}

/// Appends a Borsh `string` (4-byte little-endian length prefix + UTF-8 bytes).
fn push_borsh_string(buffer: &mut Vec<u8>, value: &[u8]) {
    buffer.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buffer.extend_from_slice(value);
}
