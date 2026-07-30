use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when the admin withdraws settled entry fees from the vault.
#[repr(C, packed)]
pub struct FeesWithdrawnEvent {
    pub pool: Address,
    pub admin: Address,
    pub amount: u64,
}

impl FeesWithdrawnEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(pool: Address, admin: Address, amount: u64) -> Self {
        Self { pool, admin, amount }
    }
}

impl EventDiscriminator for FeesWithdrawnEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::FeesWithdrawn as u8;
}

impl EventSerialize for FeesWithdrawnEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let amount = self.amount;
        writer.extend_from_slice(self.pool.as_ref());
        writer.extend_from_slice(self.admin.as_ref());
        writer.extend_from_slice(&amount.to_le_bytes());
    }
}
