#![no_std]

use pinocchio::{error::ProgramError, nostd_panic_handler, AccountView, Address, ProgramResult};

mod bn254;
use bn254::{aggregate_g2, aggregate_verify, G1_POINT, G2_POINT};

pinocchio::address::declare_id!("8v5LaPLsUEMEHnfShfovqJyUjcRHkngKhnskrYKV8WN4");

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

nostd_panic_handler!();

const COUNT_PREFIX: usize = 2;
const VERIFY_INPUT: usize = G1_POINT * 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BlsMultisigError {
    InvalidInputLength,
    SyscallFailed,
    SyscallUnavailable,
    AggregateVerifyFailed,
    InvalidMultisigAccount,
    MultisigFull,
}

impl From<BlsMultisigError> for ProgramError {
    fn from(e: BlsMultisigError) -> Self {
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
        0 => process_aggregate_verify(input),
        1 => process_add_signers(program_id, accounts, input),
        2 => process_verify(program_id, accounts, input),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn signer_count(data: &[u8]) -> usize {
    u16::from_le_bytes([data[0], data[1]]) as usize
}

/// Stateless aggregate-signature check.
///
/// # Layout
/// `aggregate_signature` (G1, 64 bytes) ‖ `negated_message_hash` (G1, 64 bytes)
/// ‖ one or more big-endian G2 public keys (128 bytes each).
///
/// Aggregates the public keys on-chain via the G2 addition syscall, then checks
/// the BLS pairing relation `e(aggSig, G2) · e(-H(m), aggPk) == 1`. Returns the
/// on-chain aggregate public key as return data.
pub fn process_aggregate_verify(input: &[u8]) -> ProgramResult {
    if input.len() < VERIFY_INPUT + G2_POINT || !(input.len() - VERIFY_INPUT).is_multiple_of(G2_POINT) {
        return Err(BlsMultisigError::InvalidInputLength.into());
    }

    let aggregate_signature = &input[..G1_POINT];
    let negated_message_hash = &input[G1_POINT..VERIFY_INPUT];
    let aggregate_pubkey = aggregate_g2(&input[VERIFY_INPUT..])?;

    if !aggregate_verify(aggregate_signature, negated_message_hash, &aggregate_pubkey)? {
        return Err(BlsMultisigError::AggregateVerifyFailed.into());
    }

    set_return_data(&aggregate_pubkey);
    Ok(())
}

/// Appends signers to the multisig account.
///
/// Account 0 is the multisig account (writable, owned by this program). Its data
/// is `[count: u16-le][G2 pubkey; count]`. The instruction data is a chunk of one
/// or more big-endian G2 public keys (128 bytes each) appended to the account.
pub fn process_add_signers(program_id: &Address, accounts: &mut [AccountView], input: &[u8]) -> ProgramResult {
    let multisig = accounts.first_mut().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if !multisig.is_writable() || !multisig.owned_by(program_id) {
        return Err(BlsMultisigError::InvalidMultisigAccount.into());
    }
    if input.is_empty() || !input.len().is_multiple_of(G2_POINT) {
        return Err(BlsMultisigError::InvalidInputLength.into());
    }

    let mut data = multisig.try_borrow_mut()?;
    if data.len() < COUNT_PREFIX {
        return Err(BlsMultisigError::InvalidMultisigAccount.into());
    }

    let count = signer_count(&data);
    let added = input.len() / G2_POINT;
    let start = COUNT_PREFIX + count * G2_POINT;
    let end = start + input.len();
    if end > data.len() {
        return Err(BlsMultisigError::MultisigFull.into());
    }

    data[start..end].copy_from_slice(input);
    let new_count = (count + added) as u16;
    data[..COUNT_PREFIX].copy_from_slice(&new_count.to_le_bytes());
    Ok(())
}

/// Verifies an aggregate signature against every registered signer.
///
/// Account 0 is the multisig account (owned by this program). The instruction
/// data is `aggregate_signature` (G1, 64 bytes) ‖ `negated_message_hash` (G1, 64
/// bytes). Every stored public key is aggregated on-chain via the G2 addition
/// syscall, then the BLS pairing relation is checked — it only holds when every
/// stored signer contributed to the aggregate signature.
pub fn process_verify(program_id: &Address, accounts: &[AccountView], input: &[u8]) -> ProgramResult {
    let multisig = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if !multisig.owned_by(program_id) {
        return Err(BlsMultisigError::InvalidMultisigAccount.into());
    }
    if input.len() != VERIFY_INPUT {
        return Err(BlsMultisigError::InvalidInputLength.into());
    }

    let aggregate_signature = &input[..G1_POINT];
    let negated_message_hash = &input[G1_POINT..];

    let data = multisig.try_borrow()?;
    if data.len() < COUNT_PREFIX {
        return Err(BlsMultisigError::InvalidMultisigAccount.into());
    }
    let count = signer_count(&data);
    let pubkeys = &data[COUNT_PREFIX..COUNT_PREFIX + count * G2_POINT];

    let aggregate_pubkey = aggregate_g2(pubkeys)?;
    if !aggregate_verify(aggregate_signature, negated_message_hash, &aggregate_pubkey)? {
        return Err(BlsMultisigError::AggregateVerifyFailed.into());
    }

    set_return_data(&aggregate_pubkey);
    Ok(())
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
