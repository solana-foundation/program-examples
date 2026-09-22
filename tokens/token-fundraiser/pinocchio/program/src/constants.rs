/// Base of the minimum campaign target.
///
/// The effective minimum is `MIN_AMOUNT_TO_RAISE.pow(decimals)` base units,
/// carried over unchanged from the Anchor version of this example so the two
/// behave identically.
pub const MIN_AMOUNT_TO_RAISE: u64 = 3;

/// Seconds in a day, used to convert elapsed seconds from the clock sysvar into
/// the whole days a campaign duration is measured in.
pub const SECONDS_TO_DAYS: i64 = 86400;

/// Share of the campaign target a single contributor may supply, as a
/// percentage scaled by [`PERCENTAGE_SCALER`].
pub const MAX_CONTRIBUTION_PERCENTAGE: u64 = 10;

/// Denominator for [`MAX_CONTRIBUTION_PERCENTAGE`].
pub const PERCENTAGE_SCALER: u64 = 100;
