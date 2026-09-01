use alloc::vec::Vec;

use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::TransferHookError,
    instructions::TOKEN_2022_PROGRAM_ID,
    token2022::{get_extension_data, TRANSFER_HOOK},
};

/// Token-2022 instruction discriminators built by hand here.
const TRANSFER_HOOK_EXTENSION: u8 = 36;
const INITIALIZE_MINT_2: u8 = 20;

/// Sub-discriminator of `TransferHookInstruction::Initialize`, which follows the
/// `TransferHookExtension` byte.
const TRANSFER_HOOK_INITIALIZE: u8 = 0;

/// Size of a Token-2022 mint carrying the `TransferHook` extension:
///
/// ```text
///   base mint (82), padded to Account::LEN (165) +
///   account-type byte (1)                        +
///   TransferHook TLV: type (2) + length (2) + value (64) = 234
/// ```
///
/// The 64-byte value is two `OptionalNonZeroPubkey`s — the extension authority
/// and the hook program — where all-zero means `None`. This mirrors
/// `ExtensionType::try_calculate_account_len::<Mint>(&[TransferHook])`.
const MINT_SIZE: usize = 234;

/// Length of the `TransferHook` extension value.
const TRANSFER_HOOK_EXTENSION_LEN: usize = 64;

/// Creates a Token-2022 mint that names this program as its transfer hook.
///
/// Every transfer of the resulting mint makes Token-2022 CPI back into this
/// program's `Execute` instruction.
///
/// Accounts:
///   0. `[signer, writable]` payer (funds the mint; becomes mint and hook authority)
///   1. `[signer, writable]` mint (a fresh keypair to initialize)
///   2. `[]`                 Token-2022 program
///   3. `[]`                 system program
///
/// Instruction data: `[decimals: u8]`
pub fn initialize(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // `token_program` and `system_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [payer, mint, _token_program, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() || !mint.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let decimals = *data.first().ok_or(ProgramError::InvalidInstructionData)?;

    let lamports = Rent::get()?.try_minimum_balance(MINT_SIZE)?;

    log!("Creating mint account");
    CreateAccount { from: payer, to: mint, lamports, space: MINT_SIZE as u64, owner: &TOKEN_2022_PROGRAM_ID }
        .invoke()?;

    // Extensions must be initialized *before* the mint itself: once the mint is
    // initialized Token-2022 rejects further extension setup.
    log!("Initializing transfer hook extension");
    let hook_data = build_transfer_hook_initialize_data(payer.address(), program_id);
    let hook_accounts = [InstructionAccount::writable(mint.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &hook_accounts, data: &hook_data },
        &[*mint],
    )?;

    log!("Initializing mint");
    let mint_data = build_initialize_mint2_data(decimals, payer.address());
    let mint_accounts = [InstructionAccount::writable(mint.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint],
    )?;

    // Read the extension back — this both confirms the mint was configured as
    // intended and demonstrates how to parse mint extension data in-program.
    check_transfer_hook_extension(mint, payer.address(), program_id)?;

    log!("Mint created with transfer hook");
    Ok(())
}

/// Confirms the freshly created mint carries a `TransferHook` extension naming
/// `authority` and this program.
fn check_transfer_hook_extension(mint: &AccountView, authority: &Address, program_id: &Address) -> ProgramResult {
    let mint_data = mint.try_borrow()?;
    let extension =
        get_extension_data(&mint_data, TRANSFER_HOOK).ok_or(TransferHookError::MissingTransferHookExtension)?;

    if extension.len() != TRANSFER_HOOK_EXTENSION_LEN {
        return Err(TransferHookError::MissingTransferHookExtension.into());
    }

    if &extension[..32] != authority.as_ref() || &extension[32..] != program_id.as_ref() {
        return Err(TransferHookError::UnexpectedTransferHookConfig.into());
    }

    Ok(())
}

/// Serializes a `TransferHookExtension(Initialize)` instruction.
///
/// Layout: `[36, 0] authority: Pubkey, program_id: Pubkey`. Both are
/// `OptionalNonZeroPubkey`s, so an all-zero value would mean `None`; here both
/// are set.
fn build_transfer_hook_initialize_data(authority: &Address, hook_program_id: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(66);
    data.push(TRANSFER_HOOK_EXTENSION);
    data.push(TRANSFER_HOOK_INITIALIZE);
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(hook_program_id.as_ref());
    data
}

/// Serializes an `InitializeMint2` instruction (variant 20).
///
/// Layout: `[20] decimals: u8, mint_authority: Pubkey, freeze_authority: COption<Pubkey>`.
/// The freeze authority is left unset, which packs as a single `0` byte.
fn build_initialize_mint2_data(decimals: u8, mint_authority: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(35);
    data.push(INITIALIZE_MINT_2);
    data.push(decimals);
    data.extend_from_slice(mint_authority.as_ref());
    data.push(0);
    data
}
