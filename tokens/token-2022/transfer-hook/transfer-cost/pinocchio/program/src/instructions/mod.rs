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

/// Seed of the counter PDA, one of the accounts the hook resolves.
pub const COUNTER_SEED: &[u8] = b"counter";

/// Size of the counter account: a single little-endian `u64`.
///
/// The Anchor version stores a `u8` behind an 8-byte account discriminator.
/// There is no discriminator here, and a `u64` cannot overflow in practice —
/// this program builds with `overflow-checks`, so a `u8` would start aborting
/// transfers after 255 of them.
pub const COUNTER_SIZE: usize = 8;

/// Seed of the delegate PDA that signs the fee transfer.
///
/// The token owner approves this PDA as a delegate on their wrapped-SOL
/// account before transferring. The hook cannot use the transfer's own signer:
/// Token-2022 CPIs into `Execute` without forwarding signer privileges, so a
/// pre-approved delegate is the only way to move the fee.
pub const DELEGATE_SEED: &[u8] = b"delegate";

/// The legacy SPL Token program ID (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
///
/// The fee is charged in wrapped SOL, which is a legacy-SPL-Token mint — so the
/// hook CPIs the old program even though the hooked mint itself is Token-2022.
pub const SPL_TOKEN_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// The associated token program ID (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`).
pub const ASSOCIATED_TOKEN_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// The native (wrapped SOL) mint, `So11111111111111111111111111111111111111112`.
pub const NATIVE_MINT: pinocchio::Address =
    pinocchio::Address::from_str_const("So11111111111111111111111111111111111111112");

/// Wrapped SOL always has 9 decimals. `TransferChecked` takes the decimals to
/// guard against a swapped mint; since the mint is pinned to `NATIVE_MINT`
/// above, the value is known rather than read back off the account.
pub const NATIVE_MINT_DECIMALS: u8 = 9;
