use anchor_lang::prelude::*;

// Records which wallet created a given collection. The collection's actual
// Metaplex update authority is the program's global `[b"authority"]` PDA,
// which signs verify_collection's CPI unconditionally for whoever calls the
// instruction — this account is what actually gates who may do so. Scoped
// per collection_mint so verifying one collection never grants authority
// over any other collection created through this program.
#[account]
pub struct CollectionAuthority {
    pub creator: Pubkey,
}

impl CollectionAuthority {
    pub const LEN: usize = 8 + 32;
}
