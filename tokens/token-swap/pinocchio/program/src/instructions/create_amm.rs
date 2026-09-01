use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::SwapError,
    instructions::expect_pda,
    state::{write_amm, AMM_SIZE, MAX_FEE_BASIS_POINTS},
    util::create_pda_account,
};

/// Creates an AMM: a namespace for pools, carrying the fee every trade pays.
///
/// The `id` is chosen by the caller and is the AMM's only seed, so one deployed
/// program can host many independent AMMs.
///
/// Accounts:
///   0. `[writable]`         amm (PDA `[id]`)
///   1. `[]`                 admin
///   2. `[signer, writable]` payer
///   3. `[]`                 system program
///
/// Instruction data: `[id: [u8; 32], fee: u16 (LE)]`
pub fn create_amm(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [amm, admin, payer, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let id: [u8; 32] = data
        .get(..32)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let fee = u16::from_le_bytes(
        data.get(32..34)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // Fees are basis points; at 10000 a trade would take the entire input.
    if fee >= MAX_FEE_BASIS_POINTS {
        return Err(SwapError::InvalidFee.into());
    }

    let bump = expect_pda(program_id, amm, &[&id])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(&id), Seed::from(&bump_bytes)];

    log!("Creating AMM");
    create_pda_account(payer, amm, AMM_SIZE, program_id, &seeds)?;

    write_amm(&mut amm.try_borrow_mut()?, &id, admin.address(), fee)?;

    log!("AMM created");
    Ok(())
}
