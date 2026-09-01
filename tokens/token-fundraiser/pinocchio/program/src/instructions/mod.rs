use pinocchio::error::ProgramError;

mod check_contributions;
mod contribute;
mod initialize;
mod refund;

pub use check_contributions::*;
pub use contribute::*;
pub use initialize::*;
pub use refund::*;

/// Minimum target (before scaling by the mint's decimals) a fundraiser may set.
pub const MIN_AMOUNT_TO_RAISE: u64 = 3;
/// Seconds in a day; the fundraiser duration is expressed in days.
pub const SECONDS_TO_DAYS: i64 = 86_400;
/// A single contributor may contribute at most this percentage of the target.
pub const MAX_CONTRIBUTION_PERCENTAGE: u64 = 10;
/// Denominator for the percentage above.
pub const PERCENTAGE_SCALER: u64 = 100;
/// The mint's `decimals` field sits at byte offset 44 of the base mint layout.
pub const MINT_DECIMALS_OFFSET: usize = 44;

/// Reads a little-endian `u64` starting at `offset` within `data`.
pub(crate) fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    data.get(offset..offset + 8)
        .and_then(|slice| slice.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or(ProgramError::InvalidInstructionData)
}

/// Reads a little-endian `u16` starting at `offset` within `data`.
pub(crate) fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    data.get(offset..offset + 2)
        .and_then(|slice| slice.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or(ProgramError::InvalidInstructionData)
}

/// Reads the `decimals` field from a base SPL mint account.
pub(crate) fn mint_decimals(mint: &pinocchio::AccountView) -> Result<u8, ProgramError> {
    let data = mint.try_borrow()?;
    data.get(MINT_DECIMALS_OFFSET).copied().ok_or(ProgramError::InvalidAccountData)
}

/// The maximum a single contributor may contribute: `MAX_CONTRIBUTION_PERCENTAGE`
/// percent of the target.
pub(crate) fn max_contribution(amount_to_raise: u64) -> u64 {
    amount_to_raise.saturating_mul(MAX_CONTRIBUTION_PERCENTAGE) / PERCENTAGE_SCALER
}

/// Number of whole days elapsed since `time_started`, using the Clock sysvar.
pub(crate) fn days_elapsed(time_started: i64) -> Result<i64, ProgramError> {
    use pinocchio::sysvars::{clock::Clock, Sysvar};
    let now = Clock::get()?.unix_timestamp;
    Ok((now - time_started) / SECONDS_TO_DAYS)
}
