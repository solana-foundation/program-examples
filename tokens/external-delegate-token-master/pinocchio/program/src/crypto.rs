//! Ethereum-flavoured primitives, declared as raw syscalls.
//!
//! `solana-keccak-hasher` and `solana-secp256k1-recover` both link `std`, which
//! collides with `nostd_panic_handler!` in a `#![no_std]` pinocchio program
//! (`duplicate lang item panic_impl`). Declaring the two syscalls directly is
//! smaller anyway, and `define_syscall!` supplies a host-side stub so the crate
//! still compiles for `cargo clippy`.

use solana_define_syscall::define_syscall;

define_syscall!(fn sol_keccak256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64);
define_syscall!(fn sol_secp256k1_recover(hash: *const u8, recovery_id: u64, signature: *const u8, result: *mut u8) -> u64);

/// Keccak-256 over the concatenation of `vals`, without allocating.
pub fn keccak256(vals: &[&[u8]]) -> [u8; 32] {
    let mut hash = [0u8; 32];
    // The syscall takes the slice-of-slices directly: `vals.as_ptr()` already
    // points at an array of (pointer, length) pairs, which is its ABI.
    unsafe {
        sol_keccak256(vals.as_ptr() as *const u8, vals.len() as u64, hash.as_mut_ptr());
    }
    hash
}

/// Recovers the signer's public key from a 64-byte signature over `digest`.
///
/// Returns the bare 64-byte `X || Y`, with **no** leading `0x04` — unlike most
/// Ethereum tooling, which returns the prefixed 65-byte form. Keccak-hashing
/// the wrong one of those produces a different address, which is the classic
/// way to get this check subtly wrong.
pub fn secp256k1_recover(digest: &[u8; 32], recovery_id: u8, signature: &[u8; 64]) -> Option<[u8; 64]> {
    let mut pubkey = [0u8; 64];
    let result =
        unsafe { sol_secp256k1_recover(digest.as_ptr(), recovery_id as u64, signature.as_ptr(), pubkey.as_mut_ptr()) };

    (result == 0).then_some(pubkey)
}

/// The Ethereum address for a recovered public key: the last 20 bytes of its
/// Keccak-256 hash.
pub fn ethereum_address(pubkey: &[u8; 64]) -> [u8; 20] {
    let hash = keccak256(&[pubkey]);
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..]);
    address
}
