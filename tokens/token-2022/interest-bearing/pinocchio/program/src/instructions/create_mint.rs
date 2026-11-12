use alloc::vec::Vec;

use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::instructions::{CreateTokenArgs, MINT_SIZE, TOKEN_2022_PROGRAM_ID};

/// Token-2022 instruction discriminators (variants of the program's instruction
/// enum) that this example builds by hand.
const INITIALIZE_MINT: u8 = 0;
/// Wrapper op for every interest-bearing instruction; the concrete instruction
/// is selected by a second discriminator byte.
const INTEREST_BEARING_MINT_EXTENSION: u8 = 33;

/// Sub-instructions of the `InterestBearingMintExtension` op (variant 33).
const INTEREST_BEARING_INITIALIZE: u8 = 0;
const INTEREST_BEARING_UPDATE_RATE: u8 = 1;

/// Interest rates for the example, in basis points, matching the anchor
/// version: 0% at init, then 1% (100 bp) after the mint is created. The rate is
/// a signed `i16` (interest may be negative).
const INITIAL_RATE: i16 = 0;
const UPDATED_RATE: i16 = 100;

/// Creates a new SPL Token-2022 mint that carries the `InterestBearingConfig`
/// extension. The token's UI amount then reflects continuously-compounding
/// interest at the configured rate; the rate authority may change the rate later.
///
/// To exercise both interest-bearing instructions (mirroring the anchor
/// example), the rate is first initialized to 0% (before `InitializeMint`), then
/// updated to 1% (after), which the rate authority signs. The payer is the rate
/// authority, and is the same key as the mint authority so a single signature
/// covers everything.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority (also set as the freeze authority)
///   2. `[signer, writable]` payer (funds the account; the rate authority; signs the rate update)
///   3. `[]`                 rent sysvar
///   4. `[]`                 system program
///   5. `[]`                 Token-2022 program
///
/// Instruction data: Borsh `[decimals: u8]`.
pub fn create_mint(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [mint_account, mint_authority, payer, rent_sysvar, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let args = CreateTokenArgs::parse(data)?;

    // Fund the mint account with enough lamports to stay rent-exempt at the
    // extended size, and create it owned by the Token-2022 program.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;

    log!("Creating mint account");
    CreateAccount { from: payer, to: mint_account, lamports, space: MINT_SIZE as u64, owner: &TOKEN_2022_PROGRAM_ID }
        .invoke()?;

    // The `InterestBearingConfig` extension must be initialized *before* the mint
    // itself, extensions live in the space past the base mint and Token-2022
    // rejects initializing them once `InitializeMint` has run.
    log!("Initializing interest bearing config (0%)");
    let init_rate_data = build_initialize_interest_bearing_data(payer, INITIAL_RATE);
    let init_rate_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_rate_accounts, data: &init_rate_data },
        &[*mint_account],
    )?;

    log!("Initializing mint");
    let mint_data = build_initialize_mint_data(mint_authority, args.decimals);
    let mint_accounts =
        [InstructionAccount::writable(mint_account.address()), InstructionAccount::readonly(rent_sysvar.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint_account, *rent_sysvar],
    )?;

    // Updating the rate can only happen once the mint is initialized, and must be
    // signed by the mint's rate authority (here, the payer).
    log!("Updating interest rate (1%)");
    let update_rate_data = build_update_rate_data(UPDATED_RATE);
    let update_rate_accounts =
        [InstructionAccount::writable(mint_account.address()), InstructionAccount::readonly_signer(payer.address())];
    invoke(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &update_rate_accounts,
            data: &update_rate_data,
        },
        &[*mint_account, *payer],
    )?;

    log!("Mint created");
    Ok(())
}

/// Serializes an `Initialize` instruction (wrapper `33`, sub `0`).
///
/// Layout: `[33][0] rate_authority: OptionalNonZeroPubkey rate: i16`. Unlike a
/// `COption`, an `OptionalNonZeroPubkey` is a bare 32-byte key (all-zero means
/// "none"), so there is no leading tag byte; the rate is little-endian.
fn build_initialize_interest_bearing_data(rate_authority: &AccountView, rate: i16) -> Vec<u8> {
    let mut data = Vec::with_capacity(36);
    data.push(INTEREST_BEARING_MINT_EXTENSION);
    data.push(INTEREST_BEARING_INITIALIZE);
    data.extend_from_slice(rate_authority.address().as_ref());
    data.extend_from_slice(&rate.to_le_bytes());
    data
}

/// Serializes an `UpdateRate` instruction (wrapper `33`, sub `1`).
///
/// Layout: `[33][1] rate: i16` (little-endian).
fn build_update_rate_data(rate: i16) -> Vec<u8> {
    let mut data = Vec::with_capacity(4);
    data.push(INTEREST_BEARING_MINT_EXTENSION);
    data.push(INTEREST_BEARING_UPDATE_RATE);
    data.extend_from_slice(&rate.to_le_bytes());
    data
}

/// Serializes an `InitializeMint` instruction (variant 0).
///
/// Layout: `[0] decimals: u8 mint_authority: Pubkey freeze_authority:
/// COption<Pubkey>`. The mint authority doubles as the freeze authority.
fn build_initialize_mint_data(mint_authority: &AccountView, decimals: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(67);
    data.push(INITIALIZE_MINT);
    data.push(decimals);
    data.extend_from_slice(mint_authority.address().as_ref());
    data.push(1); // freeze_authority: COption::Some
    data.extend_from_slice(mint_authority.address().as_ref());
    data
}
