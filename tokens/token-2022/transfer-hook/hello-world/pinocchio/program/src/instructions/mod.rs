mod initialize;
mod initialize_extra_account_meta_list;
mod transfer_hook;

pub use initialize::*;
pub use initialize_extra_account_meta_list::*;
pub use transfer_hook::*;

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
///
/// Unlike the legacy SPL Token program (which `pinocchio-token` wraps), there is
/// no pinocchio crate for Token-2022, so its instructions are built by hand and
/// CPI'd into this program.
pub const TOKEN_2022_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Seed prefix for the `ExtraAccountMetaList` PDA.
///
/// Fixed by the transfer-hook interface: during a transfer Token-2022 derives
/// `[b"extra-account-metas", mint]` against the hook program to discover which
/// additional accounts the hook needs, so the account must live at exactly this
/// address to be found.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";
