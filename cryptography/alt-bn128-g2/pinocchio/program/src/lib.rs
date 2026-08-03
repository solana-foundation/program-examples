#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

pinocchio::address::declare_id!("DbkAQTKuGJAwAPWVJdHLwxD47QBhkBTKqHBeBDJ8kzNa");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

pub const G2_POINT_SIZE: usize = 128;
pub const SCALAR_SIZE: usize = 32;
pub const G2_ADD_INPUT_SIZE: usize = G2_POINT_SIZE * 2;
pub const G2_MUL_INPUT_SIZE: usize = G2_POINT_SIZE + SCALAR_SIZE;

const ALT_BN128_G2_ADD: u64 = 4;
const ALT_BN128_G2_MUL: u64 = 6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AltBn128G2Error {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
}

impl From<AltBn128G2Error> for ProgramError {
    fn from(e: AltBn128G2Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

pub fn process_instruction(
    _program_id: &Address,
    _accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, input) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match discriminator {
        0 => process_g2_add(input),
        1 => process_g2_mul(input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Adds two big-endian G2 points (128 bytes each) via the
/// `sol_alt_bn128_group_op` syscall and returns the 128-byte sum as return data.
pub fn process_g2_add(input: &[u8]) -> ProgramResult {
    if input.len() != G2_ADD_INPUT_SIZE {
        return Err(AltBn128G2Error::InvalidInputLength.into());
    }

    let mut result = [0u8; G2_POINT_SIZE];
    alt_bn128_group_op(ALT_BN128_G2_ADD, input, &mut result)?;

    set_return_data(&result);
    Ok(())
}

/// Multiplies a big-endian G2 point (128 bytes) by a big-endian 32-byte scalar
/// via the `sol_alt_bn128_group_op` syscall and returns the 128-byte product as
/// return data.
pub fn process_g2_mul(input: &[u8]) -> ProgramResult {
    if input.len() != G2_MUL_INPUT_SIZE {
        return Err(AltBn128G2Error::InvalidInputLength.into());
    }

    let mut result = [0u8; G2_POINT_SIZE];
    alt_bn128_group_op(ALT_BN128_G2_MUL, input, &mut result)?;

    set_return_data(&result);
    Ok(())
}

#[inline(always)]
fn alt_bn128_group_op(group_op: u64, input: &[u8], output: &mut [u8]) -> Result<(), ProgramError> {
    #[cfg(target_os = "solana")]
    {
        let code = unsafe {
            pinocchio::syscalls::sol_alt_bn128_group_op(
                group_op,
                input.as_ptr(),
                input.len() as u64,
                output.as_mut_ptr(),
            )
        };
        match code {
            0 => Ok(()),
            _ => Err(AltBn128G2Error::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (group_op, input, output);
        Err(AltBn128G2Error::SyscallUnavailable.into())
    }
}

#[inline(always)]
fn set_return_data(data: &[u8]) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_set_return_data(data.as_ptr(), data.len() as u64);
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = data;
    }
}
