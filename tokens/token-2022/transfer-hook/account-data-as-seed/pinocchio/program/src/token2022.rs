//! A minimal reader for the Token-2022 TLV extension area.
//!
//! There is no pinocchio crate for Token-2022, so rather than pull in
//! `spl-token-2022` this example walks the extension list by hand. Only the two
//! extensions it cares about are named below.

/// Offset at which the TLV extension list begins.
///
/// Token-2022 lays out any account carrying extensions as its base data padded
/// to `Account::LEN` (165 bytes), a one-byte account type, then the TLV list.
/// Mints (82 bytes on their own) are padded up to 165 for exactly this reason,
/// so the same offset serves both mints and token accounts.
const TLV_START: usize = 166;

/// Marks a TLV slot that has never been written; the list ends here.
const UNINITIALIZED: u16 = 0;

/// `ExtensionType::TransferHook` — on a *mint*, names the hook program.
pub const TRANSFER_HOOK: u16 = 14;

/// `ExtensionType::TransferHookAccount` — on a *token account*, carries the
/// `transferring` flag Token-2022 raises for the duration of a transfer.
pub const TRANSFER_HOOK_ACCOUNT: u16 = 15;

/// Returns the value bytes of `extension_type`, or `None` when the account is
/// too short, holds no extensions, or does not carry this one.
///
/// Each entry is a 2-byte type, a 2-byte little-endian length, then that many
/// value bytes. Every read is bounds-checked: this parses account data that a
/// caller chose, so malformed input must return `None` rather than panic.
pub fn get_extension_data(account_data: &[u8], extension_type: u16) -> Option<&[u8]> {
    let tlv = account_data.get(TLV_START..)?;
    let mut cursor = 0usize;

    while cursor.checked_add(4)? <= tlv.len() {
        let entry_type = u16::from_le_bytes([tlv[cursor], tlv[cursor + 1]]);
        if entry_type == UNINITIALIZED {
            return None;
        }

        let length = u16::from_le_bytes([tlv[cursor + 2], tlv[cursor + 3]]) as usize;
        let value_start = cursor + 4;
        let value_end = value_start.checked_add(length)?;
        if value_end > tlv.len() {
            return None;
        }

        if entry_type == extension_type {
            return Some(&tlv[value_start..value_end]);
        }

        cursor = value_end;
    }

    None
}
