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
const INITIALIZE_PERMANENT_DELEGATE: u8 = 35;

/// Creates a new SPL Token-2022 mint that carries the `PermanentDelegate`
/// extension. The configured delegate may `Transfer` or `Burn` any of the
/// mint's token accounts without the owner's approval, permanently.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority (also set as the freeze authority)
///   2. `[]`                 permanent delegate (may transfer/burn any account)
///   3. `[signer, writable]` payer (funds the new account)
///   4. `[]`                 rent sysvar
///   5. `[]`                 system program
///   6. `[]`                 Token-2022 program
///
/// Instruction data: Borsh `[decimals: u8]`.
pub fn create_mint(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [mint_account, mint_authority, permanent_delegate, payer, rent_sysvar, _system_program, _token_program] =
        accounts
    else {
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

    // The `PermanentDelegate` extension must be initialized *before* the mint
    // itself, extensions live in the space past the base mint and Token-2022
    // rejects initializing them once `InitializeMint` has run.
    log!("Initializing permanent delegate extension");
    let permanent_delegate_data = build_initialize_permanent_delegate_data(permanent_delegate);
    let permanent_delegate_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &permanent_delegate_accounts,
            data: &permanent_delegate_data,
        },
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

    log!("Mint created");
    Ok(())
}

/// Serializes an `InitializePermanentDelegate` instruction (variant 35).
///
/// Layout: `[35] delegate: Pubkey`. Unlike `MintCloseAuthority`, the delegate is
/// a plain (non-optional) pubkey, so there is no leading `COption` tag byte.
fn build_initialize_permanent_delegate_data(delegate: &AccountView) -> Vec<u8> {
    let mut data = Vec::with_capacity(33);
    data.push(INITIALIZE_PERMANENT_DELEGATE);
    data.extend_from_slice(delegate.address().as_ref());
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
