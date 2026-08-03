#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

pinocchio::address::declare_id!("94pF5VGFSahHcn26w7UTntbo4p6yKk7G7ppLkYuVeJWN");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

pub const G2_POINT_SIZE: usize = 192;
const COUNT_PREFIX: usize = 2;

const BLS12_381_G2: u64 = 6 | 0x80;
const GROUP_OP_ADD: u64 = 0;
const GROUP_OP_SUB: u64 = 1;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BlsKeyRegistryError {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
    InvalidRegistryAccount,
    RegistryEmpty,
}

impl From<BlsKeyRegistryError> for ProgramError {
    fn from(e: BlsKeyRegistryError) -> Self {
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
        0 => process_add(program_id, accounts, input),
        1 => process_remove(program_id, accounts, input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn member_count(data: &[u8]) -> u16 {
    u16::from_le_bytes([data[0], data[1]])
}

/// Validates account 0 as the registry account (writable, owned by this
/// program) and the instruction data as exactly one 192-byte G2 public key.
/// The account stores `[count: u16-le][aggregate: 192]`.
fn registry_account<'a>(
    program_id: &Address,
    accounts: &'a mut [AccountView],
    input: &[u8],
) -> Result<&'a mut AccountView, ProgramError> {
    let account = accounts.first_mut().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if !account.is_writable() || !account.owned_by(program_id) {
        return Err(BlsKeyRegistryError::InvalidRegistryAccount.into());
    }
    if input.len() != G2_POINT_SIZE {
        return Err(BlsKeyRegistryError::InvalidInputLength.into());
    }
    Ok(account)
}

/// Adds a BLS12-381 G2 public key (192 bytes) to the registry's aggregate key
/// via the G2 addition syscall.
pub fn process_add(program_id: &Address, accounts: &mut [AccountView], input: &[u8]) -> ProgramResult {
    let account = registry_account(program_id, accounts, input)?;
    let mut data = account.try_borrow_mut()?;
    if data.len() < COUNT_PREFIX + G2_POINT_SIZE {
        return Err(BlsKeyRegistryError::InvalidRegistryAccount.into());
    }

    let count = member_count(&data);
    if count == 0 {
        data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE].copy_from_slice(input);
    } else {
        let mut current = [0u8; G2_POINT_SIZE];
        current.copy_from_slice(&data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE]);
        let mut updated = [0u8; G2_POINT_SIZE];
        curve_group_op(BLS12_381_G2, GROUP_OP_ADD, &current, input, &mut updated)?;
        data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE].copy_from_slice(&updated);
    }
    data[..COUNT_PREFIX].copy_from_slice(&(count + 1).to_le_bytes());
    Ok(())
}

/// Removes a BLS12-381 G2 public key from the registry's aggregate key via the
/// G2 subtraction syscall (BLS12-381 has native subtraction).
pub fn process_remove(program_id: &Address, accounts: &mut [AccountView], input: &[u8]) -> ProgramResult {
    let account = registry_account(program_id, accounts, input)?;
    let mut data = account.try_borrow_mut()?;
    if data.len() < COUNT_PREFIX + G2_POINT_SIZE {
        return Err(BlsKeyRegistryError::InvalidRegistryAccount.into());
    }

    let count = member_count(&data);
    if count == 0 {
        return Err(BlsKeyRegistryError::RegistryEmpty.into());
    }

    if count == 1 {
        data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE].fill(0);
    } else {
        let mut current = [0u8; G2_POINT_SIZE];
        current.copy_from_slice(&data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE]);
        let mut updated = [0u8; G2_POINT_SIZE];
        curve_group_op(BLS12_381_G2, GROUP_OP_SUB, &current, input, &mut updated)?;
        data[COUNT_PREFIX..COUNT_PREFIX + G2_POINT_SIZE].copy_from_slice(&updated);
    }
    data[..COUNT_PREFIX].copy_from_slice(&(count - 1).to_le_bytes());
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
            _ => Err(BlsKeyRegistryError::SyscallFailed.into()),
        }
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (curve_id, group_op, left, right, output);
        Err(BlsKeyRegistryError::SyscallUnavailable.into())
    }
}
