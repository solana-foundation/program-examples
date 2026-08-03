use pinocchio::error::ProgramError;

use crate::BlsMultisigError;

pub const G1_POINT: usize = 64;
pub const G2_POINT: usize = 128;

const ALT_BN128_PAIRING: u64 = 3;
const ALT_BN128_G2_ADD: u64 = 4;
const PAIRING_INPUT: usize = (G1_POINT + G2_POINT) * 2;

/// Canonical BN254 G2 generator, big-endian (EIP-197 encoding).
pub const G2_GENERATOR: [u8; G2_POINT] = [
    0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25, 0xf1, 0xaa, 0x49,
    0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2, 0x18, 0x00, 0xde, 0xef, 0x12, 0x1f,
    0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79, 0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46,
    0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed, 0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad,
    0x69, 0x0c, 0x33, 0x95, 0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97,
    0x5b, 0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f, 0xe3, 0xd1,
    0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa,
];

/// Sums a contiguous list of big-endian G2 points (128 bytes each) into one,
/// using the alt_bn128 G2 addition syscall.
pub fn aggregate_g2(points: &[u8]) -> Result<[u8; G2_POINT], ProgramError> {
    if points.is_empty() || !points.len().is_multiple_of(G2_POINT) {
        return Err(BlsMultisigError::InvalidInputLength.into());
    }

    let count = points.len() / G2_POINT;
    let mut aggregate = [0u8; G2_POINT];
    aggregate.copy_from_slice(&points[..G2_POINT]);

    let mut add_input = [0u8; G2_POINT * 2];
    for i in 1..count {
        add_input[..G2_POINT].copy_from_slice(&aggregate);
        add_input[G2_POINT..].copy_from_slice(&points[i * G2_POINT..(i + 1) * G2_POINT]);
        alt_bn128_group_op(ALT_BN128_G2_ADD, &add_input, &mut aggregate)?;
    }
    Ok(aggregate)
}

/// Checks the BLS relation `e(aggregate_signature, G2) * e(negated_message_hash,
/// aggregate_pubkey) == 1` via the alt_bn128 pairing syscall.
pub fn aggregate_verify(
    aggregate_signature: &[u8],
    negated_message_hash: &[u8],
    aggregate_pubkey: &[u8],
) -> Result<bool, ProgramError> {
    let mut input = [0u8; PAIRING_INPUT];
    input[..G1_POINT].copy_from_slice(aggregate_signature);
    input[G1_POINT..G1_POINT + G2_POINT].copy_from_slice(&G2_GENERATOR);
    input[G1_POINT + G2_POINT..G1_POINT + G2_POINT + G1_POINT].copy_from_slice(negated_message_hash);
    input[G1_POINT + G2_POINT + G1_POINT..].copy_from_slice(aggregate_pubkey);

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
            _ => Err(BlsMultisigError::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (group_op, input, output);
        Err(BlsMultisigError::SyscallUnavailable.into())
    }
}
