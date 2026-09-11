use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct MintAuthorityPda {
    pub bump: u8,
}

impl MintAuthorityPda {
    pub const SEED_PREFIX: &'static str = "mint_authority";
    pub const SIZE: usize = 8 + 8;
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct MintConfig {
    pub admin: Pubkey,
}

impl MintConfig {
    pub const SEED_PREFIX: &'static str = "mint_config";
    pub const SIZE: usize = 32;
}
