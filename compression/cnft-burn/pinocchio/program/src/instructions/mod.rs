mod burn_cnft;

pub use burn_cnft::*;

/// The mpl-bubblegum program ID
/// (`BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`).
///
/// There is no pinocchio crate for bubblegum, so its `Burn` instruction is
/// built by hand in `burn_cnft` and CPI'd into this constant — never into a
/// caller-supplied program account.
pub const MPL_BUBBLEGUM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
