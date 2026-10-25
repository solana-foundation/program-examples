use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug, Default, PartialEq, Eq)]
pub struct Amm {
    /// The primary key of the AMM
    pub id: Pubkey,

    /// Account that has admin authority over the AMM
    pub admin: Pubkey,

    /// The LP fee taken on each trade, in basis points
    pub fee: u16,
}

impl Amm {
    pub const LEN: usize = 32 + 32 + 2;
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Default, PartialEq, Eq)]
pub struct Pool {
    /// Primary key of the AMM
    pub amm: Pubkey,

    /// Mint of token A
    pub mint_a: Pubkey,

    /// Mint of token B
    pub mint_b: Pubkey,
}

impl Pool {
    pub const LEN: usize = 32 + 32 + 32;
}
