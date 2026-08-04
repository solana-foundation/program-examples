pub use ::gacha::*;
/// The codama-generated client, used for account decoding and PDA derivation so
/// the tests never re-derive what the IDL already declares.
pub use ::gacha_client as client;

pub mod utils;

pub mod tests {
    pub use crate::utils::{asserts, constants, idl, pda};

    pub mod utils {
        pub use crate::utils::test_helpers::*;
    }
}

#[cfg(test)]
mod test_account_meta;
#[cfg(test)]
mod test_buy_pull;
#[cfg(test)]
mod test_claim_prize;
#[cfg(test)]
mod test_init_pool;
#[cfg(test)]
mod test_refund_pull;
#[cfg(test)]
mod test_settle_pull;
#[cfg(test)]
mod test_withdraw_fees;
