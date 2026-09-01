use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{EXTRA_ACCOUNT_METAS_SEED, SWITCH_ON_OFFSET, SWITCH_SIZE, TOKEN_2022_PROGRAM_ID},
    token2022::{get_extension_data, TRANSFER_HOOK, TRANSFER_HOOK_ACCOUNT},
};

/// A token account stores its mint in the first 32 bytes, then its owner.
const TOKEN_ACCOUNT_MINT_RANGE: core::ops::Range<usize> = 0..32;
const TOKEN_ACCOUNT_OWNER_RANGE: core::ops::Range<usize> = 32..64;

/// Within a mint's `TransferHook` extension value, the hook program follows the
/// 32-byte extension authority.
const MINT_HOOK_PROGRAM_RANGE: core::ops::Range<usize> = 32..64;

/// The `Execute` instruction of the transfer-hook interface: Token-2022 CPIs
/// this during every transfer of a mint that names this program as its hook.
///
/// Transfers only go through while the sender's switch is on, which is what
/// makes this hook a kill switch: an admin can stop a wallet from moving the
/// token without touching the token itself.
///
/// The account order is fixed by the interface — the four transfer accounts,
/// then the `ExtraAccountMetaList`, then the accounts that list resolves to.
/// Here that is one: the switch, which Token-2022 derives from the owner it
/// reads out of the source token account and appends itself.
///
/// Accounts:
///   0. `[]` source token account
///   1. `[]` mint
///   2. `[]` destination token account
///   3. `[]` transfer authority (the token owner, or a delegate)
///   4. `[]` extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   5. `[]` wallet switch (PDA `[source token owner]`)
///
/// Instruction data: `[amount: u64 (LE)]`, unused here.
pub fn transfer_hook(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [source_token, mint, _destination_token, _authority, extra_account_meta_list, wallet_switch, ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Anyone can call this instruction directly, so confirm the account list
    // really belongs to this mint rather than trusting the caller's choice.
    let (expected_address, _) =
        Address::find_program_address(&[EXTRA_ACCOUNT_METAS_SEED, mint.address().as_ref()], program_id);
    if extra_account_meta_list.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    check_hook_is_self(mint, program_id)?;
    check_is_transferring(source_token, mint)?;

    // The switch belongs to whoever owns the tokens, not to whoever signed the
    // transfer — the authority at index 3 may be a delegate. Read the owner out
    // of the source account, which `check_is_transferring` has just confirmed
    // is a genuine Token-2022 account for this mint.
    let owner = {
        let source_data = source_token.try_borrow()?;
        let bytes = source_data.get(TOKEN_ACCOUNT_OWNER_RANGE).ok_or(TransferHookError::InvalidSourceAccount)?;
        let mut owner = [0u8; 32];
        owner.copy_from_slice(bytes);
        owner
    };
    check_switch_is_on(wallet_switch, &owner, program_id)?;

    log!("Transfer allowed");
    Ok(())
}

/// Fails unless the owner's switch exists, belongs to this program, and is on.
///
/// A wallet that has never been switched on has no account at all, which reads
/// as off — transfers are denied by default rather than allowed.
fn check_switch_is_on(wallet_switch: &AccountView, owner: &[u8; 32], program_id: &Address) -> ProgramResult {
    // The switch decides whether a transfer proceeds, so rederive it rather
    // than trusting the account the caller supplied.
    let (switch_address, _) = Address::find_program_address(&[owner], program_id);
    if wallet_switch.address() != &switch_address {
        return Err(TransferHookError::InvalidSwitchAccount.into());
    }

    // A wallet the admin has never switched on has no account here at all.
    if wallet_switch.is_data_empty() {
        return Err(TransferHookError::SwitchNotOn.into());
    }

    if !wallet_switch.owned_by(program_id) || wallet_switch.data_len() != SWITCH_SIZE {
        return Err(TransferHookError::InvalidSwitchAccount.into());
    }

    let data = wallet_switch.try_borrow()?;
    match data.get(SWITCH_ON_OFFSET) {
        Some(1) => Ok(()),
        _ => Err(TransferHookError::SwitchNotOn.into()),
    }
}

/// Fails unless `mint` actually names this program as its transfer hook.
///
/// Being mid-transfer is not on its own a reason to run: a mint configured with
/// a *different* hook program is also mid-transfer while that program runs, and
/// that program is free to CPI here with the genuine source account, passing
/// every other check. Reading the hook back off the mint is what keeps this
/// body to the transfers it was actually configured for.
fn check_hook_is_self(mint: &AccountView, program_id: &Address) -> ProgramResult {
    let mint_data = mint.try_borrow()?;
    let extension =
        get_extension_data(&mint_data, TRANSFER_HOOK).ok_or(TransferHookError::MissingTransferHookExtension)?;

    let hook_program = extension.get(MINT_HOOK_PROGRAM_RANGE).ok_or(TransferHookError::UnexpectedTransferHookConfig)?;
    if hook_program != program_id.as_ref() {
        return Err(TransferHookError::UnexpectedTransferHookConfig.into());
    }

    Ok(())
}

/// Fails unless the source account is a genuine Token-2022 account for `mint`
/// that is mid-transfer.
///
/// Token-2022 raises the `TransferHookAccount` extension's `transferring` flag
/// only for the duration of the transfer it is executing, so the flag is what
/// stops the hook being invoked directly, outside any transfer.
///
/// The flag is only worth anything if Token-2022 is what wrote it, hence the
/// two checks before it. Anyone can call `Execute` directly and hand over an
/// account they built themselves, and bytes at the right offsets would
/// otherwise read as `transferring = 1`. Requiring Token-2022 ownership *and*
/// that the account names this mint pins it to an account only Token-2022 can
/// have produced.
fn check_is_transferring(source_token: &AccountView, mint: &AccountView) -> ProgramResult {
    if !source_token.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(TransferHookError::InvalidSourceAccount.into());
    }

    let account_data = source_token.try_borrow()?;

    let account_mint = account_data.get(TOKEN_ACCOUNT_MINT_RANGE).ok_or(TransferHookError::InvalidSourceAccount)?;
    if account_mint != mint.address().as_ref() {
        return Err(TransferHookError::InvalidSourceAccount.into());
    }

    let extension = get_extension_data(&account_data, TRANSFER_HOOK_ACCOUNT)
        .ok_or(TransferHookError::IsNotCurrentlyTransferring)?;

    match extension.first() {
        Some(1) => Ok(()),
        _ => Err(TransferHookError::IsNotCurrentlyTransferring.into()),
    }
}
