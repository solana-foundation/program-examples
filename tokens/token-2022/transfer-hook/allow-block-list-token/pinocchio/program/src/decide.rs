//! The transfer decision, kept as a pure function of the decoded mint and
//! wallet state so it can be unit-tested without building real accounts.

use crate::error::AblError;

/// What the mint's metadata says.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MintMode {
    Allow,
    Block,
    Threshold(u64),
}

/// What a wallet's record says, if it has one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WalletMode {
    Allow,
    Block,
    None,
}

/// Decides whether a transfer may proceed.
///
/// A wallet with an explicit `allowed: false` record is blocked from
/// transacting entirely — neither sending nor receiving — whatever the mint's
/// mode. That is checked first and applies to both sides.
///
/// Beyond that, `Allow` and `Threshold` gate who may *receive* only, matching
/// the documented semantics of the Anchor version: `Allow` requires the
/// receiver to be on the list; `Threshold` requires it for transfers at or
/// above the threshold.
pub fn decide(mint_mode: MintMode, source: WalletMode, destination: WalletMode, amount: u64) -> Result<(), AblError> {
    if source == WalletMode::Block || destination == WalletMode::Block {
        return Err(AblError::WalletBlocked);
    }

    match (mint_mode, destination) {
        (MintMode::Allow, WalletMode::Allow) => Ok(()),
        (MintMode::Allow, _) => Err(AblError::WalletNotAllowed),
        // Neither wallet was explicitly blocked, checked above.
        (MintMode::Block, _) => Ok(()),
        (MintMode::Threshold(threshold), WalletMode::None) if amount >= threshold => Err(AblError::AmountNotAllowed),
        (MintMode::Threshold(_), _) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINT_MODES: [MintMode; 3] = [MintMode::Allow, MintMode::Block, MintMode::Threshold(100)];
    const WALLET_MODES: [WalletMode; 3] = [WalletMode::Allow, WalletMode::Block, WalletMode::None];

    #[test]
    fn a_blocked_source_is_always_rejected() {
        for mint_mode in MINT_MODES {
            for destination in WALLET_MODES {
                assert!(
                    decide(mint_mode, WalletMode::Block, destination, 0).is_err(),
                    "a blocked source must be rejected for {mint_mode:?} / {destination:?}"
                );
            }
        }
    }

    #[test]
    fn a_blocked_destination_is_always_rejected() {
        for mint_mode in MINT_MODES {
            for source in WALLET_MODES {
                assert!(
                    decide(mint_mode, source, WalletMode::Block, 0).is_err(),
                    "a blocked destination must be rejected for {mint_mode:?} / {source:?}"
                );
            }
        }
    }

    #[test]
    fn allow_mode_does_not_gate_the_source() {
        // Only "who may receive" is restricted; this is the control case
        // proving the block check above does not over-reach.
        assert!(decide(MintMode::Allow, WalletMode::None, WalletMode::Allow, 0).is_ok());
    }

    #[test]
    fn allow_mode_rejects_an_unlisted_destination() {
        assert!(decide(MintMode::Allow, WalletMode::None, WalletMode::None, 0).is_err());
    }

    #[test]
    fn block_mode_allows_unlisted_wallets() {
        assert!(decide(MintMode::Block, WalletMode::None, WalletMode::None, 0).is_ok());
    }

    #[test]
    fn threshold_mode_allows_small_transfers_to_unlisted_destinations() {
        assert!(decide(MintMode::Threshold(100), WalletMode::None, WalletMode::None, 50).is_ok());
    }

    #[test]
    fn threshold_mode_rejects_transfers_at_the_threshold() {
        assert!(decide(MintMode::Threshold(100), WalletMode::None, WalletMode::None, 100).is_err());
    }

    #[test]
    fn threshold_mode_allows_large_transfers_to_an_allowed_destination() {
        assert!(decide(MintMode::Threshold(100), WalletMode::None, WalletMode::Allow, 100).is_ok());
    }
}
