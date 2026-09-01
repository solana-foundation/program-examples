use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke, Seed},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult, Resize,
};
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::{
    error::AblError,
    instructions::{expect_pda, EXTRA_ACCOUNT_METAS_DATA, TOKEN_2022_PROGRAM_ID},
    metadata::{decimal_to_u64, metadata_initialize, metadata_update_field, read_ab_metadata, u64_to_decimal},
    state::{Mode, META_LIST_SEED, MODE_KEY, THRESHOLD_KEY},
    token2022::{get_extension_data, TRANSFER_HOOK},
    util::create_pda_account,
};

/// Token-2022 instruction discriminators built by hand here.
const INITIALIZE_MINT_2: u8 = 20;
const INITIALIZE_PERMANENT_DELEGATE: u8 = 35;
const TRANSFER_HOOK_EXTENSION: u8 = 36;
const METADATA_POINTER_EXTENSION: u8 = 39;

/// Sub-discriminators of the two extension instructions.
const EXTENSION_INITIALIZE: u8 = 0;
const EXTENSION_UPDATE: u8 = 1;

/// Size of a mint carrying `PermanentDelegate`, `TransferHook` and
/// `MetadataPointer`:
///
/// ```text
///   base mint (82), padded to Account::LEN (165) + account-type byte (1) = 166
///   PermanentDelegate  type (2) + length (2) + value (32) =  36
///   TransferHook       type (2) + length (2) + value (64) =  68
///   MetadataPointer    type (2) + length (2) + value (64) =  68
/// ```
///
/// The variable-length `TokenMetadata` written afterwards grows the account,
/// which is why both this instruction and `change_mode` top the rent up.
const MINT_SIZE: usize = 338;

fn extension_data(discriminator: u8, sub: u8, authority: &Address, target: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(66);
    data.push(discriminator);
    data.push(sub);
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(target.as_ref());
    data
}

fn invoke_on_mint(mint: &AccountView, data: &[u8]) -> ProgramResult {
    let accounts = [InstructionAccount::writable(mint.address())];
    invoke(&InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &accounts, data }, &[*mint])
}

/// Tops the account up to rent exemption for its current size.
///
/// Writing metadata reallocates the mint, so it can fall below the minimum.
fn top_up_rent(payer: &AccountView, account: &AccountView) -> ProgramResult {
    let required = Rent::get()?.try_minimum_balance(account.data_len())?;
    let current = account.lamports();
    if required > current {
        Transfer { from: payer, to: account, lamports: required - current }.invoke()?;
    }
    Ok(())
}

/// Writes the mode (and threshold, in mixed mode) into the mint's metadata.
fn write_mode(
    token_program: &AccountView,
    mint: &AccountView,
    authority: &AccountView,
    mode: Mode,
    threshold: u64,
    force_threshold: bool,
) -> ProgramResult {
    metadata_update_field(token_program.address(), mint, authority, MODE_KEY, mode.as_str().as_bytes())?;

    // Token-2022 cannot remove a metadata key, only overwrite it, so leaving
    // mixed mode zeroes the threshold rather than deleting it — the same
    // compromise the Anchor version makes.
    if mode == Mode::Mixed || force_threshold {
        let value = if mode == Mode::Mixed { threshold } else { 0 };
        metadata_update_field(token_program.address(), mint, authority, THRESHOLD_KEY, &u64_to_decimal(value))?;
    }

    Ok(())
}

/// Writes the extra-account-metas list for `mint`.
fn write_meta_list(
    program_id: &Address,
    payer: &AccountView,
    mint: &AccountView,
    meta_list: &mut AccountView,
) -> ProgramResult {
    let bump = expect_pda(program_id, meta_list, &[META_LIST_SEED, mint.address().as_ref()])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(META_LIST_SEED), Seed::from(mint.address().as_ref()), Seed::from(&bump_bytes)];

    create_pda_account(payer, meta_list, EXTRA_ACCOUNT_METAS_DATA.len(), program_id, &seeds)?;
    meta_list.try_borrow_mut()?.copy_from_slice(&EXTRA_ACCOUNT_METAS_DATA);
    Ok(())
}

/// Creates a mint that is gated by this hook from the moment it exists.
///
/// Extensions must all be initialized before the mint itself: once
/// `InitializeMint2` runs, Token-2022 refuses further extension setup.
///
/// Accounts:
///   0. `[signer, writable]` payer (mint and metadata update authority)
///   1. `[signer, writable]` mint (a fresh keypair)
///   2. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   3. `[]`                 system program
///   4. `[]`                 Token-2022 program
///
/// Instruction data:
/// `[decimals: u8, mode: u8, threshold: u64 (LE),
///   permanent_delegate: [u8; 32], transfer_hook_authority: [u8; 32],
///   name_len: u8, name, symbol_len: u8, symbol, uri_len: u8, uri]`
pub fn init_mint(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [payer, mint, meta_list, system_program, token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() || !mint.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let decimals = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
    let mode = Mode::from_byte(*data.get(1).ok_or(ProgramError::InvalidInstructionData)?)?;
    let threshold = u64::from_le_bytes(
        data.get(2..10)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let permanent_delegate: &[u8; 32] = data
        .get(10..42)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let hook_authority: &[u8; 32] = data
        .get(42..74)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let mut offset = 74usize;
    let mut strings: [&[u8]; 3] = [&[], &[], &[]];
    for slot in strings.iter_mut() {
        let len = *data.get(offset).ok_or(ProgramError::InvalidInstructionData)? as usize;
        let start = offset + 1;
        *slot = data.get(start..start + len).ok_or(ProgramError::InvalidInstructionData)?;
        offset = start + len;
    }
    let [name, symbol, uri] = strings;

    let rent = Rent::get()?;

    log!("Creating mint");
    CreateAccount {
        from: payer,
        to: mint,
        lamports: rent.try_minimum_balance(MINT_SIZE)?,
        space: MINT_SIZE as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke()?;

    // A permanent delegate can move this token from any account, which is what
    // makes an enforced allow/block list meaningful for a regulated asset.
    let mut delegate_data = Vec::with_capacity(33);
    delegate_data.push(INITIALIZE_PERMANENT_DELEGATE);
    delegate_data.extend_from_slice(permanent_delegate);
    invoke_on_mint(mint, &delegate_data)?;

    invoke_on_mint(
        mint,
        &extension_data(TRANSFER_HOOK_EXTENSION, EXTENSION_INITIALIZE, &Address::from(*hook_authority), program_id),
    )?;

    // The metadata pointer names the mint itself, so the metadata lives in the
    // mint account rather than a separate one.
    invoke_on_mint(
        mint,
        &extension_data(METADATA_POINTER_EXTENSION, EXTENSION_INITIALIZE, payer.address(), mint.address()),
    )?;

    let mut mint_data = Vec::with_capacity(35);
    mint_data.push(INITIALIZE_MINT_2);
    mint_data.push(decimals);
    mint_data.extend_from_slice(payer.address().as_ref());
    mint_data.push(0); // freeze_authority: COption::None
    invoke_on_mint(mint, &mint_data)?;

    log!("Writing metadata");
    metadata_initialize(token_program.address(), mint, payer, mint, payer, name, symbol, uri)?;
    write_mode(token_program, mint, payer, mode, threshold, false)?;
    top_up_rent(payer, mint)?;

    log!("Writing meta list");
    write_meta_list(program_id, payer, mint, meta_list)?;

    let _ = system_program;
    log!("Mint created");
    Ok(())
}

/// Points an existing mint at this hook and gives it a metas list.
///
/// Only the mint's transfer-hook authority can do this — Token-2022 enforces
/// that on the update below, so no check here would add anything.
///
/// The mint must already carry a readable `AB` policy. Attaching without one
/// would activate the hook over metadata `Execute` cannot read, and since
/// `ChangeMode` can only update metadata that already exists, a mint with no
/// `TokenMetadata` at all could never be recovered — every transfer of it would
/// fail permanently. Refusing up front makes that unreachable; set the mode
/// with `ChangeMode` first, then attach.
///
/// Accounts:
///   0. `[signer, writable]` payer (must be the mint's transfer-hook authority)
///   1. `[writable]`         mint
///   2. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   3. `[]`                 system program
///   4. `[]`                 Token-2022 program
///
/// Instruction data: none beyond the discriminator.
pub fn attach_to_mint(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, mint, meta_list, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !mint.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(AblError::InvalidAccountData.into());
    }

    // Everything `Execute` will later parse has to be readable now: a valid
    // mode alongside a malformed threshold bricks the mint just as surely as
    // no metadata at all.
    {
        let mint_data = mint.try_borrow()?;
        let metadata = read_ab_metadata(&mint_data, [MODE_KEY, THRESHOLD_KEY])?;
        let mode = metadata.mode.ok_or(AblError::InvalidMetadata)?;
        Mode::from_metadata_value(&mode)?;
        if let Some(threshold) = metadata.threshold {
            decimal_to_u64(&threshold)?;
        }
    }

    log!("Pointing the mint at this hook");
    let mut data = Vec::with_capacity(34);
    data.push(TRANSFER_HOOK_EXTENSION);
    data.push(EXTENSION_UPDATE);
    data.extend_from_slice(program_id.as_ref());
    let accounts_meta =
        [InstructionAccount::writable(mint.address()), InstructionAccount::readonly_signer(payer.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &accounts_meta, data: &data },
        &[*mint, *payer],
    )?;

    write_meta_list(program_id, payer, mint, meta_list)?;

    log!("Attached");
    Ok(())
}

/// Changes a mint's allow/block mode.
///
/// Token-2022 enforces that the signer is the metadata update authority, which
/// is the only permission this needs — the Anchor version relies on the same
/// thing and carries no config check either.
///
/// Accounts:
///   0. `[signer, writable]` authority (the metadata update authority)
///   1. `[writable]`         mint
///   2. `[]`                 Token-2022 program
///   3. `[]`                 system program
///
/// Instruction data: `[mode: u8, threshold: u64 (LE)]`
pub fn change_mode(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [authority, mint, token_program, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !mint.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(AblError::InvalidAccountData.into());
    }

    let mode = Mode::from_byte(*data.first().ok_or(ProgramError::InvalidInstructionData)?)?;
    let threshold = u64::from_le_bytes(
        data.get(1..9)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // If the mint already carries a threshold it has to be rewritten even when
    // leaving mixed mode, otherwise a stale value would keep gating transfers.
    let has_threshold = {
        let mint_data = mint.try_borrow()?;
        read_ab_metadata(&mint_data, [MODE_KEY, THRESHOLD_KEY])
            .map(|metadata| metadata.threshold.is_some_and(|value| decimal_to_u64(&value).unwrap_or(0) > 0))
            .unwrap_or(false)
    };

    write_mode(token_program, mint, authority, mode, threshold, has_threshold)?;
    top_up_rent(authority, mint)?;

    log!("Mode changed");
    Ok(())
}

/// Rewrites an existing mint's metas list to the current layout.
///
/// Permissionless on purpose: the content is fully determined by the mint and
/// this program's own fixed list, so gating it on the transfer-hook authority
/// would strand mints whose authority has been revoked.
///
/// Accounts:
///   0. `[signer, writable]` payer
///   1. `[]`                 mint
///   2. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   3. `[]`                 system program
///
/// Instruction data: none beyond the discriminator.
pub fn resize_meta_list(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, mint, meta_list, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    expect_pda(program_id, meta_list, &[META_LIST_SEED, mint.address().as_ref()])?;

    // Only rewrite lists belonging to mints that actually use this hook.
    let mint_data = mint.try_borrow()?;
    let extension = get_extension_data(&mint_data, TRANSFER_HOOK).ok_or(AblError::MintNotUsingThisHook)?;
    let hook_program = extension.get(32..64).ok_or(AblError::MintNotUsingThisHook)?;
    if hook_program != program_id.as_ref() {
        return Err(AblError::MintNotUsingThisHook.into());
    }
    drop(mint_data);

    if meta_list.data_len() != EXTRA_ACCOUNT_METAS_DATA.len() {
        meta_list.resize(EXTRA_ACCOUNT_METAS_DATA.len())?;
    }
    top_up_rent(payer, meta_list)?;
    meta_list.try_borrow_mut()?.copy_from_slice(&EXTRA_ACCOUNT_METAS_DATA);

    log!("Meta list resized");
    Ok(())
}
