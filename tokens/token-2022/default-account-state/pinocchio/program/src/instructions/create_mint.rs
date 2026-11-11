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
const DEFAULT_ACCOUNT_STATE_EXTENSION: u8 = 28;

/// Sub-instructions of the `DefaultAccountStateExtension` op (variant 28). The
/// extension's instructions are namespaced under a second discriminator byte.
const DEFAULT_ACCOUNT_STATE_INITIALIZE: u8 = 0;
const DEFAULT_ACCOUNT_STATE_UPDATE: u8 = 1;

/// `AccountState` variants, the extension's single-byte payload, mirroring
/// `spl_token_2022::state::AccountState`.
const ACCOUNT_STATE_INITIALIZED: u8 = 1;
const ACCOUNT_STATE_FROZEN: u8 = 2;

/// Creates a new SPL Token-2022 mint that carries the `DefaultAccountState`
/// extension. New token accounts for the mint inherit this default state, so a
/// mint whose default is `Frozen` requires the freeze authority to thaw each
/// account before it can be used.
///
/// To exercise both extension instructions, this mirrors the `native` example:
/// the default state is first initialized to `Frozen` (before `InitializeMint`),
/// then updated to `Initialized` (after), which requires the freeze authority to
/// sign. The mint authority doubles as the freeze authority and is supplied as
/// the same key as the payer so a single signature covers both.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority (also set as the freeze authority)
///   2. `[signer, writable]` payer (funds the account; signs the update as the freeze authority, same key as the mint authority)
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

    // The `DefaultAccountState` extension must be initialized *before* the mint
    // itself, extensions live in the space past the base mint and Token-2022
    // rejects initializing them once `InitializeMint` has run.
    log!("Initializing default account state extension (Frozen)");
    let init_state_data = [DEFAULT_ACCOUNT_STATE_EXTENSION, DEFAULT_ACCOUNT_STATE_INITIALIZE, ACCOUNT_STATE_FROZEN];
    let init_state_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_state_accounts, data: &init_state_data },
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

    // Updating the default state can only happen once the mint is initialized,
    // and must be signed by the mint's freeze authority (here, the payer).
    log!("Updating default account state (Initialized)");
    let update_state_data = [DEFAULT_ACCOUNT_STATE_EXTENSION, DEFAULT_ACCOUNT_STATE_UPDATE, ACCOUNT_STATE_INITIALIZED];
    let update_state_accounts =
        [InstructionAccount::writable(mint_account.address()), InstructionAccount::readonly_signer(payer.address())];
    invoke(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &update_state_accounts,
            data: &update_state_data,
        },
        &[*mint_account, *payer],
    )?;

    log!("Mint created");
    Ok(())
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
