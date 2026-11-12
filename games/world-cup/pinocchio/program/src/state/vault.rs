//! Pot vault marker for client PDA derivation.

use codama::CodamaAccount;

/// The pot vault, a program-owned, zero-data PDA that escrows pooled entry
/// lamports. It carries no account data; this marker exists only so the generated
/// client can derive its address.
///
/// **PDA seeds:** `["vault"]`
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "vault"))]
pub struct Vault;
