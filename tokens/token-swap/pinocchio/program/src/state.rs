//! Account layouts and the seeds that place them.
//!
//! Read and written as plain little-endian bytes. There is no 8-byte Anchor
//! account discriminator, so both accounts are 8 bytes smaller than their
//! counterparts in the Anchor version.

use pinocchio::{error::ProgramError, Address};

use crate::error::SwapError;

/// Seed suffix of the pool authority PDA.
pub const AUTHORITY_SEED: &[u8] = b"authority";

/// Seed suffix of the liquidity mint PDA.
pub const LIQUIDITY_SEED: &[u8] = b"liquidity";

/// Liquidity permanently locked on the first deposit.
///
/// It is minted to nobody, which keeps the pool from ever being fully drained
/// and stops the share price being skewed while the pool is nearly empty.
pub const MINIMUM_LIQUIDITY: u64 = 100;

/// The liquidity mint always has six decimals.
pub const LIQUIDITY_DECIMALS: u8 = 6;

/// Fees are basis points, so anything at or above this is not a fee.
pub const MAX_FEE_BASIS_POINTS: u16 = 10_000;

/// `id(32) | admin(32) | fee(2)`
pub const AMM_SIZE: usize = 66;

/// `amm(32) | mint_a(32) | mint_b(32)`
pub const POOL_SIZE: usize = 96;

/// Size of a legacy SPL Token mint.
pub const MINT_SIZE: usize = 82;

pub struct AmmData {
    pub id: [u8; 32],
    pub fee: u16,
}

pub fn read_amm(data: &[u8]) -> Result<AmmData, ProgramError> {
    if data.len() != AMM_SIZE {
        return Err(SwapError::InvalidAccountData.into());
    }
    let mut id = [0u8; 32];
    id.copy_from_slice(&data[..32]);
    Ok(AmmData { id, fee: u16::from_le_bytes(data[64..66].try_into().unwrap()) })
}

pub fn write_amm(data: &mut [u8], id: &[u8; 32], admin: &Address, fee: u16) -> Result<(), ProgramError> {
    if data.len() != AMM_SIZE {
        return Err(SwapError::InvalidAccountData.into());
    }
    data[..32].copy_from_slice(id);
    data[32..64].copy_from_slice(admin.as_ref());
    data[64..66].copy_from_slice(&fee.to_le_bytes());
    Ok(())
}

pub struct PoolData {
    pub amm: [u8; 32],
    pub mint_a: [u8; 32],
    pub mint_b: [u8; 32],
}

pub fn read_pool(data: &[u8]) -> Result<PoolData, ProgramError> {
    if data.len() != POOL_SIZE {
        return Err(SwapError::InvalidAccountData.into());
    }
    let mut pool = PoolData { amm: [0u8; 32], mint_a: [0u8; 32], mint_b: [0u8; 32] };
    pool.amm.copy_from_slice(&data[..32]);
    pool.mint_a.copy_from_slice(&data[32..64]);
    pool.mint_b.copy_from_slice(&data[64..96]);
    Ok(pool)
}

pub fn write_pool(data: &mut [u8], amm: &Address, mint_a: &Address, mint_b: &Address) -> Result<(), ProgramError> {
    if data.len() != POOL_SIZE {
        return Err(SwapError::InvalidAccountData.into());
    }
    data[..32].copy_from_slice(amm.as_ref());
    data[32..64].copy_from_slice(mint_a.as_ref());
    data[64..96].copy_from_slice(mint_b.as_ref());
    Ok(())
}

/// Reads an SPL token account's `amount` (offset 64) without deserializing the
/// whole account.
pub fn token_amount(data: &[u8]) -> Result<u64, ProgramError> {
    let bytes = data.get(64..72).ok_or(SwapError::InvalidAccountData)?;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}

/// Reads an SPL mint's `supply` (offset 36).
pub fn mint_supply(data: &[u8]) -> Result<u64, ProgramError> {
    let bytes = data.get(36..44).ok_or(SwapError::InvalidAccountData)?;
    Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
}
