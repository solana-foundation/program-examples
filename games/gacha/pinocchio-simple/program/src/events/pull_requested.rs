use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when a buyer opens a pull (the commit phase). Carries the buyer's
/// `client_seed` and the derived VRF input `alpha` so verifiers can check
/// `alpha = SHA-256(pull || client_seed)` and later reproduce the reveal.
#[repr(C, packed)]
pub struct PullRequestedEvent {
    pub pool: Address,
    pub buyer: Address,
    pub index: u64,
    pub client_seed: [u8; 32],
    pub alpha: [u8; 32],
}

impl PullRequestedEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(pool: Address, buyer: Address, index: u64, client_seed: [u8; 32], alpha: [u8; 32]) -> Self {
        Self { pool, buyer, index, client_seed, alpha }
    }
}

impl EventDiscriminator for PullRequestedEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::PullRequested as u8;
}

impl EventSerialize for PullRequestedEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let index = self.index;
        writer.extend_from_slice(self.pool.as_ref());
        writer.extend_from_slice(self.buyer.as_ref());
        writer.extend_from_slice(&index.to_le_bytes());
        writer.extend_from_slice(&self.client_seed);
        writer.extend_from_slice(&self.alpha);
    }
}
