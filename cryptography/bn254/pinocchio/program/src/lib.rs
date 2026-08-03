#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

pinocchio::address::declare_id!("DbkAQTKuGJAwAPWVJdHLwxD47QBhkBTKqHBeBDJ8kzNa");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

/// Uncompressed big-endian G1 point: x ‖ y, 32 bytes each.
pub const G1_POINT_SIZE: usize = 64;
/// Uncompressed big-endian G2 point: two Fq2 coordinates, 4 × 32 bytes.
pub const G2_POINT_SIZE: usize = 128;
/// Big-endian scalar for point multiplication.
pub const SCALAR_SIZE: usize = 32;
/// G2 add input: left point ‖ right point.
pub const G2_ADD_INPUT_SIZE: usize = G2_POINT_SIZE * 2;
/// G2 mul input: point ‖ scalar.
pub const G2_MUL_INPUT_SIZE: usize = G2_POINT_SIZE + SCALAR_SIZE;

/// `sol_alt_bn128_group_op` op code: product-of-pairings check, big-endian.
const ALT_BN128_PAIRING: u64 = 3;
/// `sol_alt_bn128_group_op` op code: G2 addition, big-endian (SIMD-0302).
const ALT_BN128_G2_ADD: u64 = 4;
/// `sol_alt_bn128_group_op` op code: G2 scalar multiplication, big-endian (SIMD-0302).
const ALT_BN128_G2_MUL: u64 = 6;

/// Aggregate-verify input prefix: aggregate signature ‖ negated message hash.
const VERIFY_HEADER: usize = G1_POINT_SIZE * 2;
/// Pairing input: two (G1, G2) pairs.
const PAIRING_INPUT: usize = (G1_POINT_SIZE + G2_POINT_SIZE) * 2;

/// Canonical BN254 G2 generator, big-endian (EIP-197 encoding).
pub const G2_GENERATOR: [u8; G2_POINT_SIZE] = [
    0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25, 0xf1, 0xaa, 0x49,
    0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2, 0x18, 0x00, 0xde, 0xef, 0x12, 0x1f,
    0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79, 0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46,
    0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed, 0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad,
    0x69, 0x0c, 0x33, 0x95, 0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97,
    0x5b, 0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f, 0xe3, 0xd1,
    0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Bn254Error {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
    AggregateVerifyFailed,
}

impl From<Bn254Error> for ProgramError {
    fn from(e: Bn254Error) -> Self {
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
        2 => process_aggregate_verify(input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// Adds two big-endian G2 points (128 bytes each) via the
/// `sol_alt_bn128_group_op` syscall and returns the 128-byte sum as return data.
pub fn process_g2_add(input: &[u8]) -> ProgramResult {
    if input.len() != G2_ADD_INPUT_SIZE {
        return Err(Bn254Error::InvalidInputLength.into());
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
        return Err(Bn254Error::InvalidInputLength.into());
    }

    let mut result = [0u8; G2_POINT_SIZE];
    alt_bn128_group_op(ALT_BN128_G2_MUL, input, &mut result)?;

    set_return_data(&result);
    Ok(())
}

/// Verifies an aggregate BLS signature over BN254 with a single pairing check.
///
/// # Layout
/// `aggregate_signature` (G1, 64 bytes) ‖ `negated_message_hash` (G1, 64 bytes)
/// ‖ one or more big-endian G2 public keys (128 bytes each).
///
/// Aggregates the public keys on-chain via the G2 addition syscall, then checks
/// the BLS pairing relation `e(aggSig, G2) · e(-H(m), aggPk) == 1`. Returns the
/// on-chain aggregate public key as return data.
pub fn process_aggregate_verify(input: &[u8]) -> ProgramResult {
    if input.len() < VERIFY_HEADER + G2_POINT_SIZE || !(input.len() - VERIFY_HEADER).is_multiple_of(G2_POINT_SIZE) {
        return Err(Bn254Error::InvalidInputLength.into());
    }

    let aggregate_signature = &input[..G1_POINT_SIZE];
    let negated_message_hash = &input[G1_POINT_SIZE..VERIFY_HEADER];
    let aggregate_pubkey = aggregate_g2(&input[VERIFY_HEADER..])?;

    if !aggregate_verify(aggregate_signature, negated_message_hash, &aggregate_pubkey)? {
        return Err(Bn254Error::AggregateVerifyFailed.into());
    }

    set_return_data(&aggregate_pubkey);
    Ok(())
}

/// Sums a contiguous list of big-endian G2 points (128 bytes each) into one,
/// using the G2 addition syscall.
fn aggregate_g2(points: &[u8]) -> Result<[u8; G2_POINT_SIZE], ProgramError> {
    let count = points.len() / G2_POINT_SIZE;
    let mut aggregate = [0u8; G2_POINT_SIZE];
    aggregate.copy_from_slice(&points[..G2_POINT_SIZE]);

    let mut add_input = [0u8; G2_ADD_INPUT_SIZE];
    for i in 1..count {
        add_input[..G2_POINT_SIZE].copy_from_slice(&aggregate);
        add_input[G2_POINT_SIZE..].copy_from_slice(&points[i * G2_POINT_SIZE..(i + 1) * G2_POINT_SIZE]);
        alt_bn128_group_op(ALT_BN128_G2_ADD, &add_input, &mut aggregate)?;
    }
    Ok(aggregate)
}

/// Checks the BLS relation `e(aggregate_signature, G2) * e(negated_message_hash,
/// aggregate_pubkey) == 1` via the alt_bn128 pairing syscall.
fn aggregate_verify(
    aggregate_signature: &[u8],
    negated_message_hash: &[u8],
    aggregate_pubkey: &[u8],
) -> Result<bool, ProgramError> {
    let mut input = [0u8; PAIRING_INPUT];
    input[..G1_POINT_SIZE].copy_from_slice(aggregate_signature);
    input[G1_POINT_SIZE..G1_POINT_SIZE + G2_POINT_SIZE].copy_from_slice(&G2_GENERATOR);
    input[G1_POINT_SIZE + G2_POINT_SIZE..G1_POINT_SIZE + G2_POINT_SIZE + G1_POINT_SIZE]
        .copy_from_slice(negated_message_hash);
    input[G1_POINT_SIZE + G2_POINT_SIZE + G1_POINT_SIZE..].copy_from_slice(aggregate_pubkey);

    let mut result = [0u8; 32];
    alt_bn128_group_op(ALT_BN128_PAIRING, &input, &mut result)?;
    Ok(result[31] == 1 && result[..31].iter().all(|&byte| byte == 0))
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
            _ => Err(Bn254Error::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (group_op, input, output);
        Err(Bn254Error::SyscallUnavailable.into())
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
