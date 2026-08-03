use pinocchio::Address;

use super::{Discriminator, Transmutable};

#[repr(C)]
pub struct WalletBlock {
    pub discriminator: u8,
    pub address: Address,
}

impl WalletBlock {
    pub const SEED_PREFIX: &'static [u8] = b"wallet_block";
}

impl Transmutable for WalletBlock {
    const LEN: usize = 1 + 32;
}

impl Discriminator for WalletBlock {
    const DISCRIMINATOR: u8 = 0x02;
}
