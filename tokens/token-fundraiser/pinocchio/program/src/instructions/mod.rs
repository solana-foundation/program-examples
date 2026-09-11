use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{error::FundraiserError, state::Fundraiser};

mod check_contributions;
mod contribute;
mod initialize;
mod refund;

pub use check_contributions::*;
pub use contribute::*;
pub use initialize::*;
pub use refund::*;

/// Reads a little-endian `u64` starting at `offset` within `data`.
pub(crate) fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes))
}

/// Reads a little-endian `u16` starting at `offset` within `data`.
pub(crate) fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    let bytes: [u8; 2] = data
        .get(offset..offset + 2)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u16::from_le_bytes(bytes))
}

/// Confirms `account` is the canonical associated token account of `wallet` for
/// `mint`.
///
/// Anchor expresses this with an `associated_token::{mint, authority}`
/// constraint; without it a caller could substitute any token account they
/// control wherever the program only checks the mint, redirecting funds.
pub(crate) fn assert_associated_token_account(
    account: &AccountView,
    wallet: &Address,
    mint: &Address,
) -> Result<(), ProgramError> {
    let (expected, _) = Address::find_program_address(
        &[wallet.as_ref(), pinocchio_token::ID.as_ref(), mint.as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if account.address() != &expected {
        return Err(FundraiserError::InvalidAccount.into());
    }
    Ok(())
}

/// Confirms `fundraiser_account` is this program's PDA for
/// `[b"fundraiser", maker]`, using the bump recorded in the account itself.
///
/// The ownership check is defense in depth: only this program can sign for its
/// own PDAs, so an account at this address cannot hold attacker-controlled
/// data. Checking anyway keeps the invariant local and obvious.
pub(crate) fn assert_fundraiser_pda(
    fundraiser_account: &AccountView,
    fundraiser: &Fundraiser,
    maker: &Address,
    program_id: &Address,
) -> Result<(), ProgramError> {
    if !fundraiser_account.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let bump_bytes = [fundraiser.bump];
    let expected = Address::create_program_address(&[Fundraiser::SEED_PREFIX, maker.as_ref(), &bump_bytes], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if fundraiser_account.address() != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(())
}

/// The largest amount a single contributor may put into a campaign with the
/// given target.
pub(crate) fn max_contribution(amount_to_raise: u64) -> Result<u64, ProgramError> {
    amount_to_raise
        .checked_mul(crate::constants::MAX_CONTRIBUTION_PERCENTAGE)
        .map(|scaled| scaled / crate::constants::PERCENTAGE_SCALER)
        .ok_or_else(|| FundraiserError::ArithmeticOverflow.into())
}

/// Whole days elapsed since `time_started`, per the clock sysvar.
pub(crate) fn elapsed_days(now: i64, time_started: i64) -> Result<i64, ProgramError> {
    now.checked_sub(time_started)
        .map(|elapsed| elapsed / crate::constants::SECONDS_TO_DAYS)
        .ok_or_else(|| FundraiserError::ArithmeticOverflow.into())
}
