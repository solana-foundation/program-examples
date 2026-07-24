use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when an admin creates a gacha pool.
#[repr(C, packed)]
pub struct PoolInitializedEvent {
    pub admin: Address,
    pub operator: Address,
    pub entry_fee: u64,
    pub tier_count: u8,
}

impl PoolInitializedEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(admin: Address, operator: Address, entry_fee: u64, tier_count: u8) -> Self {
        Self { admin, operator, entry_fee, tier_count }
    }
}

impl EventDiscriminator for PoolInitializedEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::PoolInitialized as u8;
}

impl EventSerialize for PoolInitializedEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let entry_fee = self.entry_fee;
        writer.extend_from_slice(self.admin.as_ref());
        writer.extend_from_slice(self.operator.as_ref());
        writer.extend_from_slice(&entry_fee.to_le_bytes());
        writer.push(self.tier_count);
    }
}
