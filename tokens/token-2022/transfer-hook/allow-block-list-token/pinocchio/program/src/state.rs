//! Account layouts and seeds.
//!
//! Written as plain little-endian bytes. There is no 8-byte Anchor account
//! discriminator, so both accounts are 8 bytes smaller than their counterparts.

use pinocchio::{error::ProgramError, Address};

use crate::error::AblError;

/// Seed of the program config PDA.
pub const CONFIG_SEED: &[u8] = b"config";

/// Seed prefix of a wallet's allow/block record.
pub const AB_WALLET_SEED: &[u8] = b"ab_wallet";

/// Seed prefix of the `ExtraAccountMetaList` PDA, fixed by the transfer-hook
/// interface.
pub const META_LIST_SEED: &[u8] = b"extra-account-metas";

/// `authority(32) | bump(1)`
pub const CONFIG_SIZE: usize = 33;

/// `wallet(32) | allowed(1)`
pub const AB_WALLET_SIZE: usize = 33;

/// The metadata key holding the mint's allow/block mode.
pub const MODE_KEY: &[u8] = b"AB";

/// The metadata key holding the mixed-mode threshold.
pub const THRESHOLD_KEY: &[u8] = b"threshold";

/// How a mint gates transfers.
///
/// Stored in the mint's token metadata as a string under `AB`, matching the
/// Anchor version so the two implementations read each other's mints.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Only wallets explicitly allowed may receive.
    Allow,
    /// Anyone may transact except wallets explicitly blocked.
    Block,
    /// Like `Block`, but transfers at or above the threshold need an allowed
    /// receiver.
    Mixed,
}

impl Mode {
    pub fn from_byte(byte: u8) -> Result<Self, ProgramError> {
        match byte {
            0 => Ok(Mode::Allow),
            1 => Ok(Mode::Block),
            2 => Ok(Mode::Mixed),
            _ => Err(AblError::InvalidMode.into()),
        }
    }

    /// The exact strings the Anchor version writes, via its `Display` impl.
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Allow => "Allow",
            Mode::Block => "Block",
            Mode::Mixed => "Mixed",
        }
    }

    pub fn from_metadata_value(value: &[u8]) -> Result<Self, ProgramError> {
        match value {
            b"Allow" => Ok(Mode::Allow),
            b"Block" => Ok(Mode::Block),
            b"Mixed" => Ok(Mode::Mixed),
            _ => Err(AblError::InvalidMetadata.into()),
        }
    }
}

pub fn read_config_authority(data: &[u8]) -> Result<&[u8], ProgramError> {
    if data.len() != CONFIG_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }
    Ok(&data[..32])
}

pub fn write_config(data: &mut [u8], authority: &Address, bump: u8) -> Result<(), ProgramError> {
    if data.len() != CONFIG_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }
    data[..32].copy_from_slice(authority.as_ref());
    data[32] = bump;
    Ok(())
}

/// Whether a wallet's record says it is allowed.
pub fn read_wallet_allowed(data: &[u8]) -> Result<bool, ProgramError> {
    if data.len() != AB_WALLET_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }
    Ok(data[32] != 0)
}

pub fn write_wallet(data: &mut [u8], wallet: &Address, allowed: bool) -> Result<(), ProgramError> {
    if data.len() != AB_WALLET_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }
    data[..32].copy_from_slice(wallet.as_ref());
    data[32] = allowed as u8;
    Ok(())
}
