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
/// Wrapper op for every transfer-fee instruction; the concrete instruction is
/// selected by a second discriminator byte.
const TRANSFER_FEE_EXTENSION: u8 = 26;

/// Sub-instructions of the `TransferFeeExtension` op (variant 26).
const INITIALIZE_TRANSFER_FEE_CONFIG: u8 = 0;
const SET_TRANSFER_FEE: u8 = 5;

/// Fees for the example, matching the `native` version: 1% at init, then 10%
/// after the mint is created. Expressed in basis points (1 bp = 0.01%).
const INITIAL_FEE_BASIS_POINTS: u16 = 100;
const UPDATED_FEE_BASIS_POINTS: u16 = 1000;

/// Creates a new SPL Token-2022 mint that carries the `TransferFeeConfig`
/// extension. Transfers of the mint's tokens then withhold a fee (a percentage
/// of the transferred amount, capped at `maximum_fee`) that the withdraw
/// authority can later collect.
///
/// To exercise both transfer-fee instructions (mirroring the `native` example),
/// the fee config is first initialized to 1% (before `InitializeMint`), then
/// updated to 10% (after), which the transfer-fee config authority signs. The
/// payer doubles as both the config authority and the withdraw-withheld
/// authority, and is the same key as the mint authority so a single signature
/// covers everything.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority (also set as the freeze authority)
///   2. `[signer, writable]` payer (funds the account; the transfer-fee config and withdraw authority; signs the fee update)
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

    // The max fee is 5 tokens, scaled by the mint's decimals. Guard the scaling
    // with checked arithmetic: `decimals` is unvalidated instruction input, and
    // the workspace enables `overflow-checks`, so a large value (>= 19) would
    // otherwise panic and abort the transaction instead of failing cleanly.
    let max_fee = 10u64
        .checked_pow(args.decimals as u32)
        .and_then(|scale| scale.checked_mul(5))
        .ok_or(ProgramError::InvalidInstructionData)?;

    // The `TransferFeeConfig` extension must be initialized *before* the mint
    // itself, extensions live in the space past the base mint and Token-2022
    // rejects initializing them once `InitializeMint` has run.
    log!("Initializing transfer fee config (1%)");
    let init_fee_data = build_initialize_transfer_fee_config_data(payer, INITIAL_FEE_BASIS_POINTS, max_fee);
    let init_fee_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_fee_accounts, data: &init_fee_data },
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

    // Updating the fee can only happen once the mint is initialized, and must be
    // signed by the transfer-fee config authority (here, the payer).
    log!("Updating transfer fee (10%)");
    let set_fee_data = build_set_transfer_fee_data(UPDATED_FEE_BASIS_POINTS, max_fee);
    let set_fee_accounts =
        [InstructionAccount::writable(mint_account.address()), InstructionAccount::readonly_signer(payer.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &set_fee_accounts, data: &set_fee_data },
        &[*mint_account, *payer],
    )?;

    log!("Mint created");
    Ok(())
}

/// Serializes an `InitializeTransferFeeConfig` instruction (wrapper `26`, sub
/// `0`).
///
/// Layout: `[26][0] transfer_fee_config_authority: COption<Pubkey>
/// withdraw_withheld_authority: COption<Pubkey> transfer_fee_basis_points: u16
/// maximum_fee: u64`. A present `COption` pubkey is a `1` tag byte followed by
/// the 32-byte key; multi-byte integers are little-endian. Both authorities are
/// set to the payer.
fn build_initialize_transfer_fee_config_data(authority: &AccountView, basis_points: u16, maximum_fee: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(78);
    data.push(TRANSFER_FEE_EXTENSION);
    data.push(INITIALIZE_TRANSFER_FEE_CONFIG);
    // transfer_fee_config_authority: COption::Some(payer)
    data.push(1);
    data.extend_from_slice(authority.address().as_ref());
    // withdraw_withheld_authority: COption::Some(payer)
    data.push(1);
    data.extend_from_slice(authority.address().as_ref());
    data.extend_from_slice(&basis_points.to_le_bytes());
    data.extend_from_slice(&maximum_fee.to_le_bytes());
    data
}

/// Serializes a `SetTransferFee` instruction (wrapper `26`, sub `5`).
///
/// Layout: `[26][5] transfer_fee_basis_points: u16 maximum_fee: u64`
/// (little-endian).
fn build_set_transfer_fee_data(basis_points: u16, maximum_fee: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(12);
    data.push(TRANSFER_FEE_EXTENSION);
    data.push(SET_TRANSFER_FEE);
    data.extend_from_slice(&basis_points.to_le_bytes());
    data.extend_from_slice(&maximum_fee.to_le_bytes());
    data
}

/// Serializes an `InitializeMint` instruction (variant 0).
///
/// Layout: `[0] decimals: u8 mint_authority: Pubkey freeze_authority:
/// COption<Pubkey>`. The mint authority doubles as the freeze authority, matching
/// the `native` example.
fn build_initialize_mint_data(mint_authority: &AccountView, decimals: u8) -> Vec<u8> {
    let mut data = Vec::with_capacity(67);
    data.push(INITIALIZE_MINT);
    data.push(decimals);
    data.extend_from_slice(mint_authority.address().as_ref());
    data.push(1); // freeze_authority: COption::Some
    data.extend_from_slice(mint_authority.address().as_ref());
    data
}
