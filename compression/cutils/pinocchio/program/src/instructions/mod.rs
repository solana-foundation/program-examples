mod mint;
mod verify;

pub use mint::*;
pub use verify::*;

/// The mpl-bubblegum program ID
/// (`BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY`).
///
/// There is no pinocchio crate for bubblegum, so its `MintToCollectionV1`
/// instruction is built by hand in `mint` and CPI'd into this constant — never
/// into a caller-supplied program account.
pub const MPL_BUBBLEGUM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");

/// The SPL Account Compression program ID
/// (`cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK`).
pub const SPL_ACCOUNT_COMPRESSION_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/// Keccak-256 over the concatenation of `vals`, via the runtime's syscall.
///
/// The syscall takes an array of slice descriptors, so `vals` is handed over
/// as-is rather than being copied into one contiguous buffer.
pub(crate) fn keccak(vals: &[&[u8]]) -> [u8; 32] {
    #[cfg(target_os = "solana")]
    {
        let mut hash = [0u8; 32];
        // SAFETY: `sol_keccak256` always writes exactly 32 bytes into `hash`.
        unsafe {
            pinocchio::syscalls::sol_keccak256(vals.as_ptr() as *const u8, vals.len() as u64, hash.as_mut_ptr());
        }
        hash
    }
    // Hashing is a syscall, so off-chain builds (`cargo test`, clippy) have
    // nothing to call. The program only ever runs on-chain.
    #[cfg(not(target_os = "solana"))]
    {
        let _ = vals;
        [0u8; 32]
    }
}

/// Cursor that lays out borsh-encoded data in a fixed stack buffer.
///
/// Each caller sizes its buffer for the largest payload it can produce and
/// bounds the variable-length parts first, so the writes always fit.
pub(crate) struct Writer<'a> {
    buffer: &'a mut [u8],
    offset: usize,
}

impl<'a> Writer<'a> {
    pub(crate) fn new(buffer: &'a mut [u8]) -> Self {
        Self { buffer, offset: 0 }
    }

    pub(crate) fn write(&mut self, bytes: &[u8]) {
        self.buffer[self.offset..self.offset + bytes.len()].copy_from_slice(bytes);
        self.offset += bytes.len();
    }

    /// Borsh encodes a string as a `u32` length prefix followed by its bytes.
    pub(crate) fn write_str(&mut self, value: &[u8]) {
        self.write(&(value.len() as u32).to_le_bytes());
        self.write(value);
    }

    /// Number of bytes written so far.
    pub(crate) fn written(&self) -> usize {
        self.offset
    }
}
