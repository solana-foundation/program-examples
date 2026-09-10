use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, ProgramResult,
};
use pinocchio_log::log;

use crate::instructions::TOKEN_2022_PROGRAM_ID;

/// Token-2022 `TransferChecked` instruction discriminator (variant 12).
const TRANSFER_CHECKED: u8 = 12;
/// The `decimals` field of a base mint lives at byte offset 44: a
/// `COption<Pubkey>` mint authority (4-byte tag + 32) followed by an 8-byte
/// `u64` supply.
const MINT_DECIMALS_OFFSET: usize = 44;
/// The example transfers a single base unit; the point is the CPI, not the
/// amount.
const TRANSFER_AMOUNT: u64 = 1;

/// Transfers tokens from `source` to `destination` via a Token-2022
/// `TransferChecked` CPI, signed by the source account's owner.
///
/// This is used to demonstrate the `CpiGuard` extension: when CpiGuard is
/// enabled on the source account, Token-2022 rejects this owner-authorized
/// transfer *because it happens through a CPI*. With CpiGuard disabled, the same
/// transfer succeeds. (CpiGuard itself cannot be enabled or disabled through a
/// CPI, so that is done off-chain in the test, not by this program.)
///
/// Accounts:
///   0. `[writable]`         source token account (owned by `authority`)
///   1. `[]`                 mint account (its `decimals` are read here)
///   2. `[writable]`         destination token account
///   3. `[signer]`           authority (the source account's owner)
///   4. `[]`                 Token-2022 program
pub fn cpi_transfer(accounts: &mut [AccountView]) -> ProgramResult {
    // `token_program` is unused directly, but must be supplied so it is present
    // in the transaction for the CPI below.
    let [source, mint, destination, authority, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // `TransferChecked` requires the decimals to match the mint, so read them
    // straight from the mint account's data.
    let decimals = {
        let mint_data = mint.try_borrow()?;
        *mint_data.get(MINT_DECIMALS_OFFSET).ok_or(ProgramError::InvalidAccountData)?
    };

    // Layout: `[12] amount: u64 decimals: u8` (little-endian).
    let mut data = [0u8; 10];
    data[0] = TRANSFER_CHECKED;
    data[1..9].copy_from_slice(&TRANSFER_AMOUNT.to_le_bytes());
    data[9] = decimals;

    log!("Transferring via CPI");
    let transfer_accounts = [
        InstructionAccount::writable(source.address()),
        InstructionAccount::readonly(mint.address()),
        InstructionAccount::writable(destination.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &transfer_accounts, data: &data },
        &[*source, *mint, *destination, *authority],
    )?;

    log!("Transfer complete");
    Ok(())
}
