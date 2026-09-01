use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{
        COUNTER_SEED, COUNTER_SIZE, EXTRA_ACCOUNT_METAS_SEED, TOKEN_2022_PROGRAM_ID, TOKEN_ACCOUNT_OWNER_RANGE,
    },
    token2022::{get_extension_data, TRANSFER_HOOK, TRANSFER_HOOK_ACCOUNT},
};

/// A token account stores its mint in the first 32 bytes.
const TOKEN_ACCOUNT_MINT_RANGE: core::ops::Range<usize> = 0..32;

/// Within a mint's `TransferHook` extension value, the hook program follows the
/// 32-byte extension authority.
const MINT_HOOK_PROGRAM_RANGE: core::ops::Range<usize> = 32..64;

/// The `Execute` instruction of the transfer-hook interface: Token-2022 CPIs
/// this during every transfer of a mint that names this program as its hook.
///
/// The account order is fixed by the interface — the four transfer accounts,
/// then the `ExtraAccountMetaList`, then the extra accounts that list resolves
/// to. Here that is one account: the counter, which Token-2022 derives itself
/// from a literal seed plus 32 bytes read out of the source token account's
/// data — the example's whole point.
///
/// Accounts:
///   0. `[]`         source token account
///   1. `[]`         mint
///   2. `[]`         destination token account
///   3. `[]`         transfer authority (the token owner, or a delegate)
///   4. `[]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   5. `[writable]` counter (PDA `[b"counter", source token owner]`)
///
/// Instruction data: `[amount: u64 (LE)]`.
pub fn transfer_hook(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [source_token, mint, _destination_token, _owner, extra_account_meta_list, counter, ..] = accounts else {
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

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if amount > LARGE_TRANSFER {
        log!("The amount is too big: {}", amount);
    }

    // The counter is keyed by the token owner, read from the source account
    // rather than taken from the account list — the same bytes Token-2022 used
    // to resolve the account it just handed us.
    let owner = {
        let source_data = source_token.try_borrow()?;
        let bytes = source_data.get(TOKEN_ACCOUNT_OWNER_RANGE).ok_or(TransferHookError::InvalidSourceAccount)?;
        let mut owner = [0u8; 32];
        owner.copy_from_slice(bytes);
        owner
    };

    let count = increment_counter(counter, program_id, &owner)?;
    log!("This token has been transferred {} times", count);

    Ok(())
}

/// Transfers above this are worth a log line. Mirrors the Anchor version, which
/// notes the large transfer but deliberately does not reject it.
const LARGE_TRANSFER: u64 = 50;

/// Adds one to `owner`'s counter PDA and returns the new total.
///
/// Unlike the Anchor version — which computes the incremented value but never
/// assigns it back, so its counter stays at its initial value — this persists
/// the new count.
fn increment_counter(counter: &mut AccountView, program_id: &Address, owner: &[u8; 32]) -> Result<u64, ProgramError> {
    // The counter is writable and passed by Token-2022, but `Execute` is a
    // public entrypoint: check the address and owner before writing to it.
    let (counter_address, _) = Address::find_program_address(&[COUNTER_SEED, owner], program_id);
    if counter.address() != &counter_address || !counter.owned_by(program_id) {
        return Err(TransferHookError::InvalidCounterAccount.into());
    }

    let mut data = counter.try_borrow_mut()?;
    let bytes: &mut [u8; COUNTER_SIZE] =
        (&mut data[..]).try_into().map_err(|_| TransferHookError::InvalidCounterAccount)?;

    let count = u64::from_le_bytes(*bytes).checked_add(1).ok_or(TransferHookError::CounterOverflow)?;
    *bytes = count.to_le_bytes();

    Ok(count)
}

/// Fails unless `mint` actually names this program as its transfer hook.
///
/// Being mid-transfer is not on its own a reason to run: a mint configured with
/// a *different* hook program is also mid-transfer while that program runs, and
/// that program is free to CPI here with the genuine source account, passing
/// every other check. Reading the hook back off the mint is what keeps this
/// body to the transfers it was actually configured for — the Anchor version
/// gets the same guarantee from its `extra_account_meta_list` seeds being
/// checked against a mint it has already deserialized as its own.
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
/// have produced — the Anchor version of this example gets the same guarantee
/// from its `InterfaceAccount<TokenAccount>` and `token::mint = mint`
/// constraints.
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
