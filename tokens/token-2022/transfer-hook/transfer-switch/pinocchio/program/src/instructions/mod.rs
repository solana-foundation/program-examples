mod configure_admin;
mod initialize;
mod initialize_extra_account_meta_list;
mod switch;
mod transfer_hook;

pub use configure_admin::*;
pub use initialize::*;
pub use initialize_extra_account_meta_list::*;
pub use switch::*;
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

/// Seed of the admin config PDA.
pub const ADMIN_CONFIG_SEED: &[u8] = b"admin-config";

/// Size of the admin config: one address.
///
/// The Anchor version also stores an `is_initialised` flag, because
/// `init_if_needed` hands it a zeroed account either way and it cannot
/// otherwise tell the two apart. Here the account is created explicitly, so its
/// existence *is* the flag.
pub const ADMIN_CONFIG_SIZE: usize = 32;

/// Size of a wallet's transfer switch: the wallet, then the on/off byte.
///
/// The wallet is already the account's only seed, so storing it is redundant
/// for this program — it is kept so the account can be read on its own, which
/// is what the Anchor version does.
pub const SWITCH_SIZE: usize = 33;

/// Offset of the on/off byte within a switch account.
pub const SWITCH_ON_OFFSET: usize = 32;
