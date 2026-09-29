use anchor_lang::prelude::*;

#[error_code]
pub enum MintNftError {
    #[msg("Only the collection's original creator may verify members of it")]
    Unauthorized,
}
