#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

pinocchio::address::declare_id!("4xPPrCF43BLmNQjTEfgguVG5EnGLAtDp4NN9kGE2ptAq");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

const CURVE25519_RISTRETTO: u64 = 1;
const GROUP_OP_ADD: u64 = 0;

const POINT: usize = 32;
const CIPHERTEXT: usize = 64;
const COUNT_PREFIX: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EncryptedBallotError {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
    InvalidBallotAccount,
}

impl From<EncryptedBallotError> for ProgramError {
    fn from(e: EncryptedBallotError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (discriminator, input) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match discriminator {
        0 => process_tally_add(program_id, accounts, input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn ballot_count(data: &[u8]) -> u16 {
    u16::from_le_bytes([data[0], data[1]])
}

/// Adds a twisted ElGamal ballot ciphertext (64 bytes: 32-byte commitment then
/// 32-byte decrypt handle) to the tally account's running encrypted total via
/// two ristretto255 additions. The account stores `[count: u16-le][tally: 64]`.
pub fn process_tally_add(program_id: &Address, accounts: &mut [AccountView], input: &[u8]) -> ProgramResult {
    let account = accounts.first_mut().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if !account.is_writable() || !account.owned_by(program_id) {
        return Err(EncryptedBallotError::InvalidBallotAccount.into());
    }
    if input.len() != CIPHERTEXT {
        return Err(EncryptedBallotError::InvalidInputLength.into());
    }

    let mut data = account.try_borrow_mut()?;
    if data.len() < COUNT_PREFIX + CIPHERTEXT {
        return Err(EncryptedBallotError::InvalidBallotAccount.into());
    }

    let count = ballot_count(&data);
    if count == 0 {
        data[COUNT_PREFIX..COUNT_PREFIX + CIPHERTEXT].copy_from_slice(input);
    } else {
        for offset in [0, POINT] {
            let mut current = [0u8; POINT];
            current.copy_from_slice(&data[COUNT_PREFIX + offset..COUNT_PREFIX + offset + POINT]);
            let mut updated = [0u8; POINT];
            curve_group_op(CURVE25519_RISTRETTO, GROUP_OP_ADD, &current, &input[offset..offset + POINT], &mut updated)?;
            data[COUNT_PREFIX + offset..COUNT_PREFIX + offset + POINT].copy_from_slice(&updated);
        }
    }
    data[..COUNT_PREFIX].copy_from_slice(&(count + 1).to_le_bytes());
    Ok(())
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
            _ => Err(EncryptedBallotError::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (curve_id, group_op, left, right, output);
        Err(EncryptedBallotError::SyscallUnavailable.into())
    }
}
