mod cpi_transfer;

pub use cpi_transfer::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// The Token-2022 instruction is built by hand below, to show its byte layout,
/// and CPI'd into this program. The `pinocchio-token-2022` crate provides
/// ready-made builders if you'd rather not.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
