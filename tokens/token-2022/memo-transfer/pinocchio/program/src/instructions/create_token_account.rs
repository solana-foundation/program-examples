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
/// Wrapper op for every required-memo-transfer instruction; the concrete
/// instruction is selected by a second discriminator byte.
const MEMO_TRANSFER_EXTENSION: u8 = 30;
/// Sub-instruction of the `MemoTransferExtension` op (variant 30) that turns the
/// requirement on.
const MEMO_TRANSFER_ENABLE: u8 = 0;

/// Creates a new SPL Token-2022 token account with the `MemoTransfer` extension
/// enabled. Once enabled, every transfer *into* the account must be preceded by
/// a memo instruction, or the transfer fails.
///
/// Unlike `ImmutableOwner`, this extension is enabled *after* the account is
/// initialized, and the enable must be signed by the account's owner (here, the
/// payer).
///
/// Accounts:
///   0. `[signer, writable]` token account (a fresh keypair to initialize)
///   1. `[]`                 mint account (an initialized Token-2022 mint)
///   2. `[signer, writable]` payer (funds the account; the owner; signs the enable)
///   3. `[]`                 system program
///   4. `[]`                 Token-2022 program
///
/// Instruction data: none.
pub fn create_token_account(accounts: &mut [AccountView]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [token_account, mint_account, payer, _system_program, _token_program] = accounts else {
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

    log!("Initializing token account");
    let init_data = build_initialize_account3_data(payer);
    let init_accounts =
        [InstructionAccount::writable(token_account.address()), InstructionAccount::readonly(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &init_accounts, data: &init_data },
        &[*token_account, *mint_account],
    )?;

    // `EnableRequiredMemoTransfers` must run *after* the account is initialized,
    // and must be signed by the account owner (the payer).
    log!("Enabling required memo transfers");
    let enable_accounts =
        [InstructionAccount::writable(token_account.address()), InstructionAccount::readonly_signer(payer.address())];
    invoke(
        &InstructionView {
            program_id: &TOKEN_2022_PROGRAM_ID,
            accounts: &enable_accounts,
            data: &[MEMO_TRANSFER_EXTENSION, MEMO_TRANSFER_ENABLE],
        },
        &[*token_account, *payer],
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
