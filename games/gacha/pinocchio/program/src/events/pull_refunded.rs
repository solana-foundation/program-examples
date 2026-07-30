use core::mem::size_of;

use alloc::vec::Vec;
use pinocchio::Address;

use crate::event_engine::{EventDiscriminator, EventDiscriminators, EventSerialize};

/// Emitted when a buyer reclaims a pull the operator never settled. `amount` is
/// the refunded entry fee; the pull's rent is returned separately when the
/// account closes.
#[repr(C, packed)]
pub struct PullRefundedEvent {
    pub pool: Address,
    pub buyer: Address,
    pub index: u64,
    pub amount: u64,
}

impl PullRefundedEvent {
    pub const DATA_LEN: usize = size_of::<Self>();

    pub fn new(pool: Address, buyer: Address, index: u64, amount: u64) -> Self {
        Self { pool, buyer, index, amount }
    }
}

impl EventDiscriminator for PullRefundedEvent {
    const DISCRIMINATOR: u8 = EventDiscriminators::PullRefunded as u8;
}

impl EventSerialize for PullRefundedEvent {
    const DATA_LEN: usize = Self::DATA_LEN;

    fn write_inner(&self, writer: &mut Vec<u8>) {
        let index = self.index;
        let amount = self.amount;
        writer.extend_from_slice(self.pool.as_ref());
        writer.extend_from_slice(self.buyer.as_ref());
        writer.extend_from_slice(&index.to_le_bytes());
        writer.extend_from_slice(&amount.to_le_bytes());
    }
}
