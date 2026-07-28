use pinocchio::error::ProgramError;

/// Reads a Borsh `string` (a 4-byte little-endian length prefix followed by that
/// many UTF-8 bytes) starting at `*offset`, advancing `offset` past it.
pub fn read_borsh_string<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], ProgramError> {
    let len_bytes: [u8; 4] = data
        .get(*offset..*offset + 4)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let len = u32::from_le_bytes(len_bytes) as usize;
    *offset += 4;

    let bytes = data.get(*offset..*offset + len).ok_or(ProgramError::InvalidInstructionData)?;
    *offset += len;
    Ok(bytes)
}

/// Writes `bytes` into `buffer` at `*offset`, advancing `offset`. Returns
/// `InvalidInstructionData` if they don't fit — keeping the program `alloc`-free
/// (a growable `Vec` pulls in codegen the bankrun test runtime can't execute).
pub fn write_bytes(buffer: &mut [u8], offset: &mut usize, bytes: &[u8]) -> Result<(), ProgramError> {
    let end = *offset + bytes.len();
    buffer.get_mut(*offset..end).ok_or(ProgramError::InvalidInstructionData)?.copy_from_slice(bytes);
    *offset = end;
    Ok(())
}

/// Writes a Borsh `string` (4-byte little-endian length prefix + UTF-8 bytes).
pub fn write_borsh_string(buffer: &mut [u8], offset: &mut usize, value: &[u8]) -> Result<(), ProgramError> {
    write_bytes(buffer, offset, &(value.len() as u32).to_le_bytes())?;
    write_bytes(buffer, offset, value)
}
