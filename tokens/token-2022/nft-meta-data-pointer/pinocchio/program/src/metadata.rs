//! Writing the NFT's SPL token metadata.
//!
//! The metadata lives in the mint itself — that is what the `MetadataPointer`
//! extension pointing at the mint means — so no separate metadata account is
//! ever created. There is no pinocchio crate for the token-metadata interface,
//! so both instructions are built by hand.
//!
//! Unlike the sibling allow/block-list example, the update authority here is a
//! PDA of this program, so every call is `invoke_signed`.

use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

/// `spl_token_metadata_interface` discriminators: the first eight bytes of
/// `sha256("spl_token_metadata_interface:<name>")`, computed from the preimages
/// in the interface crate rather than copied.
const METADATA_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];
const METADATA_UPDATE_FIELD: [u8; 8] = [221, 233, 49, 45, 181, 202, 220, 200];

/// `Field::Key(..)` — a caller-defined key, rather than the built-in
/// name/symbol/uri fields.
const FIELD_KEY: u8 = 3;

/// Borsh-encodes a string: a little-endian u32 length, then the bytes.
fn push_string(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

/// Initializes the mint's metadata, signed by the PDA that owns it.
#[allow(clippy::too_many_arguments)]
pub fn metadata_initialize(
    token_program: &Address,
    mint: &AccountView,
    authority: &AccountView,
    name: &[u8],
    symbol: &[u8],
    uri: &[u8],
    signers: &[Signer],
) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 12 + name.len() + symbol.len() + uri.len());
    data.extend_from_slice(&METADATA_INITIALIZE);
    push_string(&mut data, name);
    push_string(&mut data, symbol);
    push_string(&mut data, uri);

    // metadata, update authority, mint, mint authority — the metadata and the
    // mint are the same account here, as are the two authorities, but the CPI
    // still expects one account info per meta.
    let accounts = [
        InstructionAccount::writable(mint.address()),
        InstructionAccount::readonly(authority.address()),
        InstructionAccount::readonly(mint.address()),
        InstructionAccount::readonly_signer(authority.address()),
    ];

    invoke_signed(
        &InstructionView { program_id: token_program, accounts: &accounts, data: &data },
        &[*mint, *authority, *mint, *authority],
        signers,
    )
}

/// Sets one caller-defined metadata key, signed by the PDA that owns the mint.
///
/// This is how the NFT stays live: the program rewrites `wood` on the mint
/// every time the player chops, so the token's own metadata tracks progress
/// with no off-chain indexer involved.
pub fn metadata_update_field(
    token_program: &Address,
    mint: &AccountView,
    authority: &AccountView,
    key: &[u8],
    value: &[u8],
    signers: &[Signer],
) -> ProgramResult {
    let mut data = Vec::with_capacity(8 + 1 + 8 + key.len() + value.len());
    data.extend_from_slice(&METADATA_UPDATE_FIELD);
    data.push(FIELD_KEY);
    push_string(&mut data, key);
    push_string(&mut data, value);

    let accounts =
        [InstructionAccount::writable(mint.address()), InstructionAccount::readonly_signer(authority.address())];

    invoke_signed(
        &InstructionView { program_id: token_program, accounts: &accounts, data: &data },
        &[*mint, *authority],
        signers,
    )
}

/// Formats a `u64` as a decimal string.
///
/// The reference stores these values with `to_string()`, so the bytes have to
/// match for both implementations to read the same NFT.
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
