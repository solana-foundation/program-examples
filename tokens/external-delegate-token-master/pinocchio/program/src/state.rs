//! The per-user account layout.
//!
//! Written by hand as little-endian bytes: unlike Anchor there is no 8-byte
//! account discriminator, so the account is 60 bytes rather than 68.

use pinocchio::{error::ProgramError, Address};

use crate::error::DelegateError;

/// `authority(32) | ethereum_address(20) | nonce(8)`
pub const USER_ACCOUNT_SIZE: usize = 60;

/// Seed of the PDA that holds token authority for a user account: `[user_account]`.
///
/// Tokens are parked in an account owned by this PDA, so the program can move
/// them on an Ethereum signature without the Solana wallet signing.
pub const USER_PDA_SEEDS_LEN: usize = 1;

pub struct UserAccount<'a>(&'a mut [u8]);

impl<'a> UserAccount<'a> {
    pub fn from_bytes(data: &'a mut [u8]) -> Result<Self, ProgramError> {
        if data.len() != USER_ACCOUNT_SIZE {
            return Err(DelegateError::InvalidAccountData.into());
        }
        Ok(Self(data))
    }

    pub fn authority(&self) -> &[u8] {
        &self.0[..32]
    }

    pub fn ethereum_address(&self) -> [u8; 20] {
        let mut address = [0u8; 20];
        address.copy_from_slice(&self.0[32..52]);
        address
    }

    pub fn set_ethereum_address(&mut self, address: &[u8; 20]) {
        self.0[32..52].copy_from_slice(address);
    }

    pub fn nonce(&self) -> u64 {
        u64::from_le_bytes(self.0[52..60].try_into().unwrap())
    }

    pub fn set_nonce(&mut self, nonce: u64) {
        self.0[52..60].copy_from_slice(&nonce.to_le_bytes());
    }

    /// A fresh account: the authority is recorded, and both the Ethereum
    /// address and the nonce start zeroed — matching the Anchor version, where
    /// an unset address is `[0; 20]`.
    pub fn initialize(&mut self, authority: &Address) {
        self.0[..32].copy_from_slice(authority.as_ref());
        self.0[32..].fill(0);
    }
}
