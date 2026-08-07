//! Prize mint marker for client PDA derivation.

use codama::CodamaAccount;

/// The prize mint — a Token-2022 mint created by `settle_and_distribute`, one
/// per settled pull. It is owned by the Token-2022 program, not this program;
/// this marker exists only so the generated client can derive its address. Its
/// existence is also the structural once-only guard: a second settle for the
/// same pull fails when this account cannot be created again.
///
/// **PDA seeds:** `["mint", pull]`
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "mint"))]
#[codama(seed(name = "pull", type = public_key))]
pub struct PrizeMint;
