use anchor_lang::prelude::*;

#[error_code]
pub enum TokenMinterError {
    #[msg("Only the admin recorded at token creation may mint")]
    Unauthorized,
}
