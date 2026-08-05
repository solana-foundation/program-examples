use pinocchio::error::ProgramError;

mod make_offer;
mod refund_offer;
mod take_offer;

pub use make_offer::*;
pub use refund_offer::*;
pub use take_offer::*;

/// Reads a little-endian `u64` starting at `offset` within `data`.
pub(crate) fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes))
}
