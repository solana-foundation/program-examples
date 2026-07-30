use solana_pubkey::Pubkey;

use crate::{
    state::common::{MINT_SEED, POOL_SEED, PULL_SEED, VAULT_SEED},
    tests::constants::{ATA_PROGRAM_ID, PROGRAM_ID, TOKEN_2022_ID},
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

pub fn get_mint_pda(pull: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MINT_SEED, pull.as_ref()], &PROGRAM_ID)
}

/// Derives the buyer's Token-2022 associated token account for a mint.
pub fn get_ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), TOKEN_2022_ID.as_ref(), mint.as_ref()], &ATA_PROGRAM_ID).0
}
