use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when a settled pull's prize NFT is minted to the buyer.
#[repr(C, packed)]
pub struct PrizeClaimedEvent {
    pub pool: Address,
    pub buyer: Address,
    pub index: u64,
    pub tier: u8,
    pub mint: Address,
}

impl PrizeClaimedEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(pool: Address, buyer: Address, index: u64, tier: u8, mint: Address) -> Self {
        Self { pool, buyer, index, tier, mint }
    }
}

impl EventDiscriminator for PrizeClaimedEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::PrizeClaimed as u8;
}

impl EventSerialize for PrizeClaimedEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let index = self.index;
        writer.extend_from_slice(self.pool.as_ref());
        writer.extend_from_slice(self.buyer.as_ref());
        writer.extend_from_slice(&index.to_le_bytes());
        writer.push(self.tier);
        writer.extend_from_slice(self.mint.as_ref());
    }
}
