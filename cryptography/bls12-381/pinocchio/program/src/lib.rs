#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

pinocchio::address::declare_id!("BdDTbzTrA7xrfZ6zm3Xy8UHvJjzQSdFDsGZWqwFKFJeF");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

/// Uncompressed big-endian G1 point: x ‖ y, 48 bytes each.
pub const G1_POINT_SIZE: usize = 96;
/// Uncompressed big-endian G2 point: two Fq2 coordinates, 4 × 48 bytes.
pub const G2_POINT_SIZE: usize = 192;
/// Big-endian scalar for point multiplication.
pub const SCALAR_SIZE: usize = 32;

/// `sol_curve_group_op` curve id for BLS12-381 G1; `0x80` selects big-endian encoding.
const BLS12_381_G1: u64 = 5 | 0x80;
/// `sol_curve_group_op` curve id for BLS12-381 G2; `0x80` selects big-endian encoding.
const BLS12_381_G2: u64 = 6 | 0x80;
/// `sol_curve_group_op` group op code: point addition.
const ADD: u64 = 0;
/// `sol_curve_group_op` group op code: point subtraction.
const SUB: u64 = 1;
/// `sol_curve_group_op` group op code: scalar multiplication (scalar ‖ point operands).
const MUL: u64 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Bls12381Error {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
}

impl From<Bls12381Error> for ProgramError {
    fn from(e: Bls12381Error) -> Self {
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
        0 => point_op::<G1_POINT_SIZE>(BLS12_381_G1, ADD, input),
        1 => point_op::<G1_POINT_SIZE>(BLS12_381_G1, SUB, input),
        2 => scalar_mul::<G1_POINT_SIZE>(BLS12_381_G1, input),
        3 => point_op::<G2_POINT_SIZE>(BLS12_381_G2, ADD, input),
        4 => point_op::<G2_POINT_SIZE>(BLS12_381_G2, SUB, input),
        5 => scalar_mul::<G2_POINT_SIZE>(BLS12_381_G2, input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Adds or subtracts two big-endian points of the given size via the
/// `sol_curve_group_op` syscall and returns the result as return data.
fn point_op<const POINT: usize>(curve_id: u64, group_op: u64, input: &[u8]) -> ProgramResult {
    let (left, right) = split_operands(input, POINT, POINT)?;
    let mut result = [0u8; POINT];
    curve_group_op(curve_id, group_op, left, right, &mut result)?;
    set_return_data(&result);
    Ok(())
}

/// Multiplies a big-endian point by a 32-byte big-endian scalar. The syscall
/// takes the scalar as the left operand and the point as the right operand.
fn scalar_mul<const POINT: usize>(curve_id: u64, input: &[u8]) -> ProgramResult {
    let (scalar, point) = split_operands(input, SCALAR_SIZE, POINT)?;
    let mut result = [0u8; POINT];
    curve_group_op(curve_id, MUL, scalar, point, &mut result)?;
    set_return_data(&result);
    Ok(())
}

fn split_operands(data: &[u8], left_len: usize, right_len: usize) -> Result<(&[u8], &[u8]), ProgramError> {
    if data.len() != left_len + right_len {
        return Err(Bls12381Error::InvalidInputLength.into());
    }
    Ok(data.split_at(left_len))
}

#[inline(always)]
fn curve_group_op(
    curve_id: u64,
    group_op: u64,
    left: &[u8],
    right: &[u8],
    output: &mut [u8],
) -> Result<(), ProgramError> {
    #[cfg(target_os = "solana")]
    {
        let code = unsafe {
            pinocchio::syscalls::sol_curve_group_op(
                curve_id,
                group_op,
                left.as_ptr(),
                right.as_ptr(),
                output.as_mut_ptr(),
            )
        };
        match code {
            0 => Ok(()),
            _ => Err(Bls12381Error::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (curve_id, group_op, left, right, output);
        Err(Bls12381Error::SyscallUnavailable.into())
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
