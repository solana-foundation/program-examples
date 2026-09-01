//! Account layouts.
//!
//! Both are plain little-endian structs written by hand: unlike Anchor there is
//! no 8-byte account discriminator, so every offset below is 8 bytes lower than
//! its counterpart in the Anchor version.

use pinocchio::{error::ProgramError, Address};

use crate::error::ClaimError;

/// Seed prefix of the airdrop state PDA, `[b"merkle_tree", mint]`.
pub const AIRDROP_STATE_SEED: &[u8] = b"merkle_tree";

/// Seed prefix of a claim receipt PDA, `[b"claim_receipt", airdrop_state, index]`.
pub const CLAIM_RECEIPT_SEED: &[u8] = b"claim_receipt";

/// `merkle_root(32) | authority(32) | mint(32) | airdrop_amount(8) | amount_claimed(8) | bump(1)`
pub const AIRDROP_STATE_SIZE: usize = 113;

/// `airdrop_state(32) | claimer(32) | index(8) | amount(8) | bump(1)`
pub const CLAIM_RECEIPT_SIZE: usize = 81;

/// The airdrop's mint always has six decimals, matching the Anchor version's
/// `mint::decimals = 6`.
pub const MINT_DECIMALS: u8 = 6;

/// A borrowed view over an airdrop state account.
pub struct AirdropState<'a>(&'a mut [u8]);

impl<'a> AirdropState<'a> {
    pub fn from_bytes(data: &'a mut [u8]) -> Result<Self, ProgramError> {
        if data.len() != AIRDROP_STATE_SIZE {
            return Err(ClaimError::InvalidAccountData.into());
        }
        Ok(Self(data))
    }

    pub fn merkle_root(&self) -> &[u8] {
        &self.0[..32]
    }

    pub fn set_merkle_root(&mut self, root: &[u8; 32]) {
        self.0[..32].copy_from_slice(root);
    }

    pub fn authority(&self) -> &[u8] {
        &self.0[32..64]
    }

    pub fn mint(&self) -> &[u8] {
        &self.0[64..96]
    }

    pub fn airdrop_amount(&self) -> u64 {
        u64::from_le_bytes(self.0[96..104].try_into().unwrap())
    }

    pub fn amount_claimed(&self) -> u64 {
        u64::from_le_bytes(self.0[104..112].try_into().unwrap())
    }

    pub fn set_amount_claimed(&mut self, amount: u64) {
        self.0[104..112].copy_from_slice(&amount.to_le_bytes());
    }

    pub fn bump(&self) -> u8 {
        self.0[112]
    }

    pub fn initialize(&mut self, merkle_root: &[u8; 32], authority: &Address, mint: &Address, amount: u64, bump: u8) {
        self.0[..32].copy_from_slice(merkle_root);
        self.0[32..64].copy_from_slice(authority.as_ref());
        self.0[64..96].copy_from_slice(mint.as_ref());
        self.0[96..104].copy_from_slice(&amount.to_le_bytes());
        self.0[104..112].copy_from_slice(&0u64.to_le_bytes());
        self.0[112] = bump;
    }
}

/// A borrowed view over a claim receipt account.
pub struct ClaimReceipt<'a>(&'a mut [u8]);

impl<'a> ClaimReceipt<'a> {
    pub fn from_bytes(data: &'a mut [u8]) -> Result<Self, ProgramError> {
        if data.len() != CLAIM_RECEIPT_SIZE {
            return Err(ClaimError::InvalidAccountData.into());
        }
        Ok(Self(data))
    }

    /// A receipt that has never been written still has an all-zero claimer,
    /// which is how the Anchor version detects an unused `init_if_needed`
    /// account too.
    pub fn is_claimed(&self) -> bool {
        self.0[32..64].iter().any(|byte| *byte != 0)
    }

    pub fn write(&mut self, airdrop_state: &Address, claimer: &Address, index: u64, amount: u64, bump: u8) {
        self.0[..32].copy_from_slice(airdrop_state.as_ref());
        self.0[32..64].copy_from_slice(claimer.as_ref());
        self.0[64..72].copy_from_slice(&index.to_le_bytes());
        self.0[72..80].copy_from_slice(&amount.to_le_bytes());
        self.0[80] = bump;
    }
}
