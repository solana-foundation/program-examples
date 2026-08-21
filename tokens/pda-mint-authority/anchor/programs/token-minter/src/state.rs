use anchor_lang::prelude::*;

// Tracks who is allowed to mint from this program's single global mint. The
// mint's own authority is a PDA that signs unconditionally, so this account is
// the only thing gating who may trigger it.
#[account]
pub struct MintConfig {
    pub admin: Pubkey,
}

impl MintConfig {
    pub const LEN: usize = 8 + 32;
}
