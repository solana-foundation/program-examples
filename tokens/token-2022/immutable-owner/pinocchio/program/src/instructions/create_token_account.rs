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

use crate::instructions::{ACCOUNT_SIZE, TOKEN_2022_PROGRAM_ID};

/// Token-2022 instruction discriminators (variants of the program's instruction
/// enum) that this example builds by hand.
const INITIALIZE_ACCOUNT_3: u8 = 18;
const INITIALIZE_IMMUTABLE_OWNER: u8 = 22;

/// Creates a new SPL Token-2022 token account that carries the `ImmutableOwner`
/// extension. Once initialized, the account's owner can never be changed, a
/// `SetAuthority(AccountOwner)` on it will always fail.
///
/// Accounts:
///   0. `[signer, writable]` token account (a fresh keypair to initialize)
///   1. `[]`                 mint account (an initialized Token-2022 mint)
///   2. `[]`                 owner (the account's immutable owner/authority)
///   3. `[signer, writable]` payer (funds the new account)
///   4. `[]`                 system program
///   5. `[]`                 Token-2022 program
///
/// Instruction data: none.
pub fn create_token_account(accounts: &mut [AccountView]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [token_account, mint_account, owner, payer, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Fund the token account with enough lamports to stay rent-exempt at the
    // extended size, and create it owned by the Token-2022 program.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(ACCOUNT_SIZE)?;

    log!("Creating token account");
    CreateAccount {
        from: payer,
        to: token_account,
        lamports,
        space: ACCOUNT_SIZE as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke()?;

    // `InitializeImmutableOwner` must run *before* the account itself is
    // initialized, the extension can only be added to an uninitialized account.
    log!("Initializing immutable owner extension");
    let immutable_owner_accounts = [InstructionAccount::writable(token_account.address())];
    invoke(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &immutable_owner_accounts,
            data: &[INITIALIZE_IMMUTABLE_OWNER],
        },
        &[*token_account],
    )?;

    log!("Initializing token account");
    let init_data = build_initialize_account3_data(owner);
    let init_accounts =
        [InstructionAccount::writable(token_account.address()), InstructionAccount::readonly(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_accounts, data: &init_data },
        &[*token_account, *mint_account],
    )?;

    log!("Token account created");
    Ok(())
}

/// Serializes an `InitializeAccount3` instruction (variant 18).
///
/// Layout: `[18] owner: Pubkey`. Unlike `InitializeAccount`, the owner is passed
/// in the instruction data rather than as an account, and no rent sysvar account
/// is required.
fn build_initialize_account3_data(owner: &AccountView) -> Vec<u8> {
    let mut data = Vec::with_capacity(33);
    data.push(INITIALIZE_ACCOUNT_3);
    data.extend_from_slice(owner.address().as_ref());
    data
}
