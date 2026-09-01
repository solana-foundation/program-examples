use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::instructions::TransferChecked;

use crate::{
    error::TransferHookError,
    instructions::{
        ASSOCIATED_TOKEN_PROGRAM_ID, COUNTER_SEED, COUNTER_SIZE, DELEGATE_SEED, EXTRA_ACCOUNT_METAS_SEED, NATIVE_MINT,
        NATIVE_MINT_DECIMALS, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
    },
    token2022::{get_extension_data, TRANSFER_HOOK, TRANSFER_HOOK_ACCOUNT},
};

/// A token account stores its mint in the first 32 bytes.
const TOKEN_ACCOUNT_MINT_RANGE: core::ops::Range<usize> = 0..32;

/// Within a mint's `TransferHook` extension value, the hook program follows the
/// 32-byte extension authority.
const MINT_HOOK_PROGRAM_RANGE: core::ops::Range<usize> = 32..64;

/// Transfers above this are worth a log line. Mirrors the Anchor version, which
/// notes the large transfer but deliberately does not reject it.
const LARGE_TRANSFER: u64 = 50;

/// The `Execute` instruction of the transfer-hook interface: Token-2022 CPIs
/// this during every transfer of a mint that names this program as its hook.
///
/// This hook charges a fee in wrapped SOL equal to the token amount being
/// transferred, moving it from the sender's wSOL account to the delegate's.
///
/// The fee cannot be signed for by whoever signed the transfer: Token-2022 CPIs
/// into `Execute` without forwarding signer privileges, so nothing in the
/// account list below is a signer. Instead the sender approves a PDA of this
/// program as a delegate on their wSOL account beforehand, and the hook signs
/// as that PDA.
///
/// The account order is fixed by the interface — the four transfer accounts,
/// then the `ExtraAccountMetaList`, then the seven accounts that list resolves
/// to, in the order it lists them.
///
/// Accounts:
///   0.  `[]`         source token account
///   1.  `[]`         mint
///   2.  `[]`         destination token account
///   3.  `[]`         transfer authority (the token owner, or a delegate)
///   4.  `[]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   5.  `[]`         wrapped SOL mint
///   6.  `[]`         SPL Token program
///   7.  `[]`         associated token program
///   8.  `[writable]` delegate (PDA `[b"delegate"]`)
///   9.  `[writable]` delegate's wrapped SOL account
///   10. `[writable]` sender's wrapped SOL account
///   11. `[writable]` counter (PDA `[b"counter"]`)
///
/// Instruction data: `[amount: u64 (LE)]`.
pub fn transfer_hook(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [source_token, mint, _destination_token, authority, extra_account_meta_list, wsol_mint, token_program, associated_token_program, delegate, delegate_wsol, sender_wsol, counter, ..] =
        accounts
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

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if amount > LARGE_TRANSFER {
        log!("The amount is too big: {}", amount);
    }

    let count = increment_counter(counter, program_id)?;
    log!("This token has been transferred {} times", count);

    // Token-2022 resolved every one of these from the list, but `Execute` is a
    // public entrypoint that anyone can call with accounts of their choosing —
    // so each is rederived here before the fee is moved.
    if wsol_mint.address() != &NATIVE_MINT
        || token_program.address() != &SPL_TOKEN_PROGRAM_ID
        || associated_token_program.address() != &ASSOCIATED_TOKEN_PROGRAM_ID
    {
        return Err(TransferHookError::UnexpectedFeeAccount.into());
    }

    let (delegate_address, delegate_bump) = Address::find_program_address(&[DELEGATE_SEED], program_id);
    if delegate.address() != &delegate_address
        || delegate_wsol.address() != &associated_token_address(&delegate_address)
        || sender_wsol.address() != &associated_token_address(authority.address())
    {
        return Err(TransferHookError::UnexpectedFeeAccount.into());
    }

    let delegate_bump_bytes = [delegate_bump];
    let delegate_seeds = [Seed::from(DELEGATE_SEED), Seed::from(&delegate_bump_bytes)];

    log!("Charging {} lamports of wrapped SOL", amount);
    // The turbofish pins the (empty) multisig-signer slice's element type,
    // which nothing else in this call constrains.
    TransferChecked::<&AccountView> {
        from: sender_wsol,
        mint: wsol_mint,
        to: delegate_wsol,
        authority: delegate,
        amount,
        decimals: NATIVE_MINT_DECIMALS,
        multisig_signers: &[],
    }
    .invoke_signed(&[Signer::from(&delegate_seeds)])?;

    Ok(())
}

/// Derives `owner`'s associated wrapped-SOL account.
///
/// The associated token program derives its accounts as
/// `[owner, token program, mint]`, which is exactly what the
/// `ExtraAccountMetaList` told Token-2022 to resolve — so this recomputes the
/// address the hook was handed rather than trusting it.
fn associated_token_address(owner: &Address) -> Address {
    let (address, _) = Address::find_program_address(
        &[owner.as_ref(), SPL_TOKEN_PROGRAM_ID.as_ref(), NATIVE_MINT.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    address
}

/// Adds one to the counter PDA and returns the new total.
///
/// The Anchor version stores this as a `u8`; a `u64` here means a busy mint
/// cannot start failing transfers once the count passes 255.
fn increment_counter(counter: &mut AccountView, program_id: &Address) -> Result<u64, ProgramError> {
    // The counter is writable and passed by Token-2022, but `Execute` is a
    // public entrypoint: check the address and owner before writing to it.
    let (counter_address, _) = Address::find_program_address(&[COUNTER_SEED], program_id);
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
/// body — and the fee it charges — to the transfers it was configured for.
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
/// stops the hook being invoked directly, outside any transfer — which here
/// would mean charging the fee without a transfer having happened.
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
