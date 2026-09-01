use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    decide::{decide, MintMode, WalletMode},
    error::AblError,
    instructions::{expect_pda, TOKEN_2022_PROGRAM_ID},
    metadata::{decimal_to_u64, read_ab_metadata},
    state::{read_wallet_allowed, Mode, AB_WALLET_SEED, AB_WALLET_SIZE, META_LIST_SEED, MODE_KEY, THRESHOLD_KEY},
    token2022::{get_extension_data, TRANSFER_HOOK, TRANSFER_HOOK_ACCOUNT},
};

/// A token account stores its mint in the first 32 bytes, then its owner.
const TOKEN_ACCOUNT_MINT_RANGE: core::ops::Range<usize> = 0..32;
const TOKEN_ACCOUNT_OWNER_RANGE: core::ops::Range<usize> = 32..64;

/// The `Execute` instruction of the transfer-hook interface.
///
/// Token-2022 CPIs this on every transfer of a mint that names this program.
/// The two allow/block records are resolved from the list, which derives them
/// from the owners recorded in the source and destination token accounts — so
/// neither side can nominate its own record.
///
/// Accounts:
///   0. `[]` source token account
///   1. `[]` mint
///   2. `[]` destination token account
///   3. `[]` transfer authority (the owner, or a delegate)
///   4. `[]` extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   5. `[]` source wallet's record (PDA `[b"ab_wallet", source owner]`)
///   6. `[]` destination wallet's record (PDA `[b"ab_wallet", destination owner]`)
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn tx_hook(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [source_token, mint, destination_token, _authority, meta_list, source_record, destination_record, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // Anyone can call `Execute` directly, so none of these accounts are taken
    // on trust. The Anchor version declares them all `UncheckedAccount` and
    // validates nothing; every check below is this port's addition.
    expect_pda(program_id, meta_list, &[META_LIST_SEED, mint.address().as_ref()])?;
    check_hook_is_self(mint, program_id)?;
    check_is_transferring(source_token, mint)?;

    let source_owner = token_account_owner(source_token)?;
    let destination_owner = token_account_owner(destination_token)?;
    expect_pda(program_id, source_record, &[AB_WALLET_SEED, &source_owner])?;
    expect_pda(program_id, destination_record, &[AB_WALLET_SEED, &destination_owner])?;

    let mint_mode = read_mint_mode(mint)?;
    let source_mode = read_wallet_mode(program_id, source_record)?;
    let destination_mode = read_wallet_mode(program_id, destination_record)?;

    decide(mint_mode, source_mode, destination_mode, amount)?;

    log!("Transfer allowed");
    Ok(())
}

fn token_account_owner(token_account: &AccountView) -> Result<[u8; 32], ProgramError> {
    let data = token_account.try_borrow()?;
    let bytes = data.get(TOKEN_ACCOUNT_OWNER_RANGE).ok_or(AblError::InvalidSourceAccount)?;
    let mut owner = [0u8; 32];
    owner.copy_from_slice(bytes);
    Ok(owner)
}

/// A wallet with no record is neither allowed nor blocked.
fn read_wallet_mode(program_id: &Address, record: &AccountView) -> Result<WalletMode, ProgramError> {
    if record.is_data_empty() {
        return Ok(WalletMode::None);
    }
    if !record.owned_by(program_id) || record.data_len() != AB_WALLET_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }

    if read_wallet_allowed(&record.try_borrow()?)? {
        Ok(WalletMode::Allow)
    } else {
        Ok(WalletMode::Block)
    }
}

/// Reads the mode out of the mint's metadata.
///
/// A mint whose metadata names a threshold is in mixed mode regardless of what
/// the `AB` key says, matching the Anchor version's precedence — leaving mixed
/// mode zeroes the threshold rather than removing the key.
fn read_mint_mode(mint: &AccountView) -> Result<MintMode, ProgramError> {
    let mint_data = mint.try_borrow()?;
    let metadata = read_ab_metadata(&mint_data, [MODE_KEY, THRESHOLD_KEY])?;

    let threshold = match metadata.threshold {
        Some(value) => decimal_to_u64(&value)?,
        None => 0,
    };
    if threshold > 0 {
        return Ok(MintMode::Threshold(threshold));
    }

    match metadata.mode {
        Some(value) => match Mode::from_metadata_value(&value)? {
            Mode::Allow => Ok(MintMode::Allow),
            Mode::Block => Ok(MintMode::Block),
            Mode::Mixed => Ok(MintMode::Threshold(threshold)),
        },
        None => Err(AblError::InvalidMetadata.into()),
    }
}

/// Fails unless `mint` names this program as its transfer hook.
///
/// A mint hooked to a different program is mid-transfer too while that program
/// runs, and could otherwise CPI here and be told its transfer is fine.
fn check_hook_is_self(mint: &AccountView, program_id: &Address) -> ProgramResult {
    let mint_data = mint.try_borrow()?;
    let extension = get_extension_data(&mint_data, TRANSFER_HOOK).ok_or(AblError::MintNotUsingThisHook)?;
    let hook_program = extension.get(32..64).ok_or(AblError::MintNotUsingThisHook)?;
    if hook_program != program_id.as_ref() {
        return Err(AblError::MintNotUsingThisHook.into());
    }
    Ok(())
}

/// Fails unless the source account is a genuine Token-2022 account for `mint`
/// that is mid-transfer.
fn check_is_transferring(source_token: &AccountView, mint: &AccountView) -> ProgramResult {
    if !source_token.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(AblError::InvalidSourceAccount.into());
    }

    let account_data = source_token.try_borrow()?;
    let account_mint = account_data.get(TOKEN_ACCOUNT_MINT_RANGE).ok_or(AblError::InvalidSourceAccount)?;
    if account_mint != mint.address().as_ref() {
        return Err(AblError::InvalidSourceAccount.into());
    }

    let extension =
        get_extension_data(&account_data, TRANSFER_HOOK_ACCOUNT).ok_or(AblError::IsNotCurrentlyTransferring)?;
    match extension.first() {
        Some(1) => Ok(()),
        _ => Err(AblError::IsNotCurrentlyTransferring.into()),
    }
}
