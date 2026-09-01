use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke, invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
    instructions::{expect_pda, expect_token_program, top_up_rent, TOKEN_2022_PROGRAM_ID},
    metadata::{metadata_initialize, metadata_update_field},
    state::NFT_AUTHORITY_SEED,
};

/// Token-2022 instruction discriminators built by hand here.
const INITIALIZE_MINT_2: u8 = 20;
const METADATA_POINTER_EXTENSION: u8 = 39;
const SET_AUTHORITY: u8 = 6;
const MINT_TO: u8 = 7;

const EXTENSION_INITIALIZE: u8 = 0;

/// `AuthorityType::MintTokens`.
const AUTHORITY_TYPE_MINT_TOKENS: u8 = 0;

/// Size of a mint carrying only `MetadataPointer`:
///
/// ```text
///   base mint (82), padded to Account::LEN (165) + account-type byte (1) = 166
///   MetadataPointer  type (2) + length (2) + value (64) = 68
/// ```
///
/// The variable-length `TokenMetadata` written afterwards grows the account,
/// which is why the rent is topped up once it is in place.
const MINT_SIZE: usize = 234;

/// What every NFT this program mints is called.
const NFT_NAME: &[u8] = b"Beaver";
const NFT_SYMBOL: &[u8] = b"BVA";
const NFT_URI: &[u8] = b"https://arweave.net/MHK3Iopy0GgvDoM7LkkiAdg7pQqExuuWvedApCnzfj0";

/// The metadata key holding the player's level, set once at mint time.
const LEVEL_KEY: &[u8] = b"level";

fn invoke_on_mint(mint: &AccountView, data: &[u8]) -> ProgramResult {
    let accounts = [InstructionAccount::writable(mint.address())];
    invoke(&InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &accounts, data }, &[*mint])
}

/// Mints the player's NFT: one token, no decimals, metadata in the mint itself.
///
/// The mint authority is a PDA of this program and is revoked once the single
/// token exists, so the supply is fixed at one — but the *metadata* update
/// authority stays with that PDA, which is what lets `chop_tree` keep rewriting
/// the NFT as the player progresses.
///
/// Accounts:
///   0. `[signer, writable]` signer (pays, receives the NFT)
///   1. `[signer, writable]` mint (a fresh keypair)
///   2. `[writable]`         signer's associated token account
///   3. `[]`                 nft authority (PDA `[b"nft_authority"]`)
///   4. `[]`                 system program
///   5. `[]`                 Token-2022 program
///   6. `[]`                 associated token program
///
/// Instruction data: none beyond the discriminator.
pub fn mint_nft(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [signer, mint, token_account, nft_authority, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !signer.is_signer() || !mint.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    expect_token_program(token_program)?;

    let bump = expect_pda(program_id, nft_authority, &[NFT_AUTHORITY_SEED])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(NFT_AUTHORITY_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating mint");
    CreateAccount {
        from: signer,
        to: mint,
        lamports: Rent::get()?.try_minimum_balance(MINT_SIZE)?,
        space: MINT_SIZE as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke()?;

    // The pointer names the mint itself, so the metadata lives in the mint and
    // no second account is needed. This has to happen before the mint is
    // initialized — Token-2022 refuses extension setup afterwards.
    let mut pointer_data = Vec::with_capacity(66);
    pointer_data.push(METADATA_POINTER_EXTENSION);
    pointer_data.push(EXTENSION_INITIALIZE);
    pointer_data.extend_from_slice(nft_authority.address().as_ref());
    pointer_data.extend_from_slice(mint.address().as_ref());
    invoke_on_mint(mint, &pointer_data)?;

    let mut mint_data = Vec::with_capacity(35);
    mint_data.push(INITIALIZE_MINT_2);
    mint_data.push(0); // decimals: an NFT is indivisible
    mint_data.extend_from_slice(nft_authority.address().as_ref());
    mint_data.push(0); // freeze_authority: COption::None
    invoke_on_mint(mint, &mint_data)?;

    log!("Writing metadata");
    metadata_initialize(&TOKEN_2022_PROGRAM_ID, mint, nft_authority, NFT_NAME, NFT_SYMBOL, NFT_URI, &signers)?;
    metadata_update_field(&TOKEN_2022_PROGRAM_ID, mint, nft_authority, LEVEL_KEY, b"1", &signers)?;
    top_up_rent(signer, mint)?;

    log!("Creating token account");
    Create { funding_account: signer, account: token_account, wallet: signer, mint, system_program, token_program }
        .invoke()?;

    log!("Minting one token");
    let mut mint_to_data = Vec::with_capacity(9);
    mint_to_data.push(MINT_TO);
    mint_to_data.extend_from_slice(&1u64.to_le_bytes());
    let mint_to_accounts = [
        InstructionAccount::writable(mint.address()),
        InstructionAccount::writable(token_account.address()),
        InstructionAccount::readonly_signer(nft_authority.address()),
    ];
    invoke_signed(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_to_accounts, data: &mint_to_data },
        &[*mint, *token_account, *nft_authority],
        &signers,
    )?;

    // Revoke minting so the supply is fixed at the single token — this is what
    // makes it an NFT rather than a one-unit fungible mint. The metadata
    // authority is untouched, so the program can still update it.
    log!("Revoking the mint authority");
    let set_authority_data = [SET_AUTHORITY, AUTHORITY_TYPE_MINT_TOKENS, 0];
    let set_authority_accounts =
        [InstructionAccount::writable(mint.address()), InstructionAccount::readonly_signer(nft_authority.address())];
    invoke_signed(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &set_authority_accounts,
            data: &set_authority_data,
        },
        &[*mint, *nft_authority],
        &signers,
    )?;

    log!("NFT minted");
    Ok(())
}
