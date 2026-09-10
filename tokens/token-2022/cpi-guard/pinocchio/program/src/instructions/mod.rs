mod cpi_transfer;

pub use cpi_transfer::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Unlike the legacy SPL Token program (which `pinocchio-token` wraps), there is
/// no pinocchio crate for Token-2022, so its instructions are built by hand
/// below and CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
