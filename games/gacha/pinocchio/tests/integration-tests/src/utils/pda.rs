use solana_pubkey::Pubkey;

use crate::{
    state::common::{POOL_SEED, PULL_SEED, VAULT_SEED},
    tests::constants::PROGRAM_ID,
};

pub fn get_pool_pda(admin: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_SEED, admin.as_ref()], &PROGRAM_ID)
}

pub fn get_vault_pda(admin: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, admin.as_ref()], &PROGRAM_ID)
}

pub fn get_pull_pda(pool: &Pubkey, buyer: &Pubkey, index: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PULL_SEED, pool.as_ref(), buyer.as_ref(), &index.to_le_bytes()], &PROGRAM_ID)
}
