//! Reading and writing the mint's SPL token metadata.
//!
//! The mode this hook enforces lives in the mint's own `TokenMetadata`
//! extension, under the `AB` key, with an optional `threshold`. There is no
//! pinocchio crate for either Token-2022 or the token-metadata interface, so
//! the TLV value is parsed and the two instructions are built by hand.

use alloc::vec::Vec;

use pinocchio::{
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

use crate::{error::AblError, token2022::get_extension_data};

/// `ExtensionType::TokenMetadata`, a variable-length extension.
pub const TOKEN_METADATA: u16 = 19;

/// `spl_token_metadata_interface` discriminators: the first eight bytes of
/// `sha256("spl_token_metadata_interface:<name>")`.
///
/// Computed from the preimages in the interface crate rather than copied, since
/// the crate never spells the bytes out.
const METADATA_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const METADATA_UPDATE_FIELD: [u8; 8] = [221, 233, 49, 45, 181, 202, 220, 200];

/// `Field::Key(..)` — the variant for a caller-defined key, as opposed to the
/// three built-in name/symbol/uri fields.
const FIELD_KEY: u8 = 3;

/// Borsh-encodes a string: a little-endian u32 length, then the bytes.
fn push_string(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

/// Reads a borsh string, returning it and the offset just past it.
fn read_string(data: &[u8], offset: usize) -> Result<(&[u8], usize), ProgramError> {
    let len_bytes = data.get(offset..offset + 4).ok_or(AblError::InvalidMetadata)?;
    let len = u32::from_le_bytes(len_bytes.try_into().unwrap()) as usize;
    let start = offset + 4;
    let end = start.checked_add(len).ok_or(AblError::InvalidMetadata)?;
    let value = data.get(start..end).ok_or(AblError::InvalidMetadata)?;
    Ok((value, end))
}

/// The two values this hook cares about, read out of the mint's metadata.
pub struct AbMetadata {
    pub mode: Option<Vec<u8>>,
    pub threshold: Option<Vec<u8>>,
}

/// Parses `TokenMetadata` out of a mint and returns the `AB` and `threshold`
/// entries.
///
/// The extension's value is
/// `update_authority(32) | mint(32) | name | symbol | uri | additional[]`,
/// where every string is borsh-encoded and `additional` is a length-prefixed
/// list of key/value pairs. Every read is bounds-checked: this parses account
/// data a caller chose, so malformed input must error rather than panic.
pub fn read_ab_metadata(mint_data: &[u8], keys: [&[u8]; 2]) -> Result<AbMetadata, ProgramError> {
    let value = get_extension_data(mint_data, TOKEN_METADATA).ok_or(AblError::InvalidMetadata)?;

    // Skip the update authority and mint.
    let mut offset = 64usize;
    for _ in 0..3 {
        let (_, next) = read_string(value, offset)?;
        offset = next;
    }

    let count_bytes = value.get(offset..offset + 4).ok_or(AblError::InvalidMetadata)?;
    let count = u32::from_le_bytes(count_bytes.try_into().unwrap());
    offset += 4;

    let mut found: [Option<Vec<u8>>; 2] = [None, None];
    for _ in 0..count {
        let (key, next) = read_string(value, offset)?;
        let (entry, next) = read_string(value, next)?;
        offset = next;

        for (index, wanted) in keys.iter().enumerate() {
            if key == *wanted && found[index].is_none() {
                found[index] = Some(entry.to_vec());
            }
        }
    }

    let [mode, threshold] = found;
    Ok(AbMetadata { mode, threshold })
}

/// Builds and invokes `Initialize` on the token-metadata interface.
///
/// The metadata lives in the mint itself, so `metadata` and `mint` are the same
/// account — that is what the `MetadataPointer` extension pointing at the mint
/// means.
#[allow(clippy::too_many_arguments)]
pub fn metadata_initialize(
    token_program: &Address,
    metadata: &AccountView,
    update_authority: &AccountView,
    mint: &AccountView,
    mint_authority: &AccountView,
    name: &[u8],
    symbol: &[u8],
    uri: &[u8],
) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 12 + name.len() + symbol.len() + uri.len());
    data.extend_from_slice(&METADATA_INITIALIZE);
    push_string(&mut data, name);
    push_string(&mut data, symbol);
    push_string(&mut data, uri);

    let accounts = [
        InstructionAccount::writable(metadata.address()),
        InstructionAccount::readonly(update_authority.address()),
        InstructionAccount::readonly(mint.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
    ];

    // One account info per instruction meta — the metadata and the mint are the
    // same account here, as are the two authorities, but the CPI still expects
    // the list to line up.
    pinocchio::cpi::invoke(
        &InstructionView { program_id: token_program, accounts: &accounts, data: &data },
        &[*metadata, *update_authority, *mint, *mint_authority],
    )
}

/// Builds and invokes `UpdateField` for a caller-defined key.
pub fn metadata_update_field(
    token_program: &Address,
    metadata: &AccountView,
    update_authority: &AccountView,
    key: &[u8],
    value: &[u8],
) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 1 + 8 + key.len() + value.len());
    data.extend_from_slice(&METADATA_UPDATE_FIELD);
    data.push(FIELD_KEY);
    push_string(&mut data, key);
    push_string(&mut data, value);

    let accounts = [
        InstructionAccount::writable(metadata.address()),
        InstructionAccount::readonly_signer(update_authority.address()),
    ];

    pinocchio::cpi::invoke(
        &InstructionView { program_id: token_program, accounts: &accounts, data: &data },
        &[*metadata, *update_authority],
    )
}

/// Formats a `u64` into a decimal string without allocating a formatter.
///
/// The Anchor version stores the threshold as `u64::to_string()`, so this has
/// to produce the same bytes for the two implementations to read each other's
/// mints.
pub fn u64_to_decimal(mut value: u64) -> Vec<u8> {
    if value == 0 {
        return alloc::vec![b'0'];
    }

    let mut digits = Vec::with_capacity(20);
    while value > 0 {
        digits.push(b'0' + (value % 10) as u8);
        value /= 10;
    }
    digits.reverse();
    digits
}

/// Parses a decimal string back into a `u64`.
pub fn decimal_to_u64(bytes: &[u8]) -> Result<u64, ProgramError> {
    if bytes.is_empty() {
        return Err(AblError::InvalidMetadata.into());
    }

    let mut value = 0u64;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return Err(AblError::InvalidMetadata.into());
        }
        value =
            value.checked_mul(10).and_then(|v| v.checked_add((byte - b'0') as u64)).ok_or(AblError::InvalidMetadata)?;
    }
    Ok(value)
}
