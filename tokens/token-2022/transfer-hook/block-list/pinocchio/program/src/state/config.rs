use pinocchio::Address;

use super::{Discriminator, Transmutable};

#[repr(C, packed)]
pub struct Config {
    pub discriminator: u8,
    pub authority: Address,
    pub blocked_wallets_count: u64,
}

impl Config {
    pub const SEED_PREFIX: &'static [u8] = b"config";
}

impl Transmutable for Config {
    const LEN: usize = 1 + 32 + 8;
}

impl Discriminator for Config {
    const DISCRIMINATOR: u8 = 0x01;
}
