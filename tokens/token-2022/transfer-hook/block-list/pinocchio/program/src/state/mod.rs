pub mod config;
pub mod wallet_block;
pub use config::*;
pub use wallet_block::*;

use crate::BlockListError;

pub trait Transmutable {
    const LEN: usize;
}

pub trait Discriminator {
    const DISCRIMINATOR: u8;
}

/// Return a reference for an initialized `T` from the given bytes.
///
/// # Safety
///
/// The caller must ensure that `bytes` contains a valid representation of `T`.
#[inline(always)]
pub unsafe fn load<T: Discriminator + Transmutable>(bytes: &[u8]) -> Result<&T, BlockListError> {
    load_unchecked(bytes).and_then(|t: &T| {
        // checks if the data is initialized
        if bytes[0] == T::DISCRIMINATOR {
            Ok(t)
        } else {
            Err(BlockListError::InvalidAccountData)
        }
    })
}

/// Return a `T` reference from the given bytes.
///
/// This function does not check if the data is initialized.
///
/// # Safety
///
/// The caller must ensure that `bytes` contains a valid representation of `T`.
#[inline(always)]
pub unsafe fn load_unchecked<T: Transmutable>(bytes: &[u8]) -> Result<&T, BlockListError> {
    if bytes.len() != T::LEN {
        return Err(BlockListError::InvalidAccountData);
    }
    Ok(&*(bytes.as_ptr() as *const T))
}

/// Return a mutable `T` reference from the given bytes.
///
/// This function does not check if the data is initialized.
///
/// # Safety
///
/// The caller must ensure that `bytes` contains a valid representation of `T`.
#[inline(always)]
pub unsafe fn load_mut_unchecked<T: Transmutable>(bytes: &mut [u8]) -> Result<&mut T, BlockListError> {
    if bytes.len() != T::LEN {
        return Err(BlockListError::InvalidAccountData);
    }
    Ok(&mut *(bytes.as_mut_ptr() as *mut T))
}
