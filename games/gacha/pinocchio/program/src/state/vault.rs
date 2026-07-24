//! Pot vault marker for client PDA derivation.

use codama::CodamaAccount;

/// The pot vault — a program-owned, zero-data PDA that escrows a pool's pooled
/// entry lamports. It carries no account data; this marker exists only so the
/// generated client can derive its address.
///
/// **PDA seeds:** `["vault", admin]`
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "vault"))]
#[codama(seed(name = "admin", type = public_key))]
pub struct Vault;
