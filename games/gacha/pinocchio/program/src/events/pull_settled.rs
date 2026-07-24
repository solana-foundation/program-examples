use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when the operator reveals a pull (the reveal phase). Carries `alpha`,
/// `beta`, and the 80-byte ECVRF `proof` so anyone can verify `beta = VRF(alpha)`
/// off-chain and reproduce the selected `tier`.
#[repr(C, packed)]
pub struct PullSettledEvent {
    pub pool: Address,
    pub buyer: Address,
    pub index: u64,
    pub tier: u8,
    pub alpha: [u8; 32],
    pub beta: [u8; 64],
    pub proof: [u8; 80],
}

impl PullSettledEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(
        pool: Address,
        buyer: Address,
        index: u64,
        tier: u8,
        alpha: [u8; 32],
        beta: [u8; 64],
        proof: [u8; 80],
    ) -> Self {
        Self { pool, buyer, index, tier, alpha, beta, proof }
    }
}

impl EventDiscriminator for PullSettledEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::PullSettled as u8;
}

impl EventSerialize for PullSettledEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let index = self.index;
        writer.extend_from_slice(self.pool.as_ref());
        writer.extend_from_slice(self.buyer.as_ref());
        writer.extend_from_slice(&index.to_le_bytes());
        writer.push(self.tier);
        writer.extend_from_slice(&self.alpha);
        writer.extend_from_slice(&self.beta);
        writer.extend_from_slice(&self.proof);
    }
}
