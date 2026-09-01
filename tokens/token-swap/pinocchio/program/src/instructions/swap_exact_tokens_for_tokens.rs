use pinocchio::{cpi::Signer, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
    error::SwapError,
    instructions::{expect_pda, mul_div, PoolSeeds},
    state::{read_amm, token_amount, MAX_FEE_BASIS_POINTS},
};

/// Trades an exact input amount for as much of the other side as the curve
/// gives, refusing anything below `min_output_amount`.
///
/// Accounts:
///   0. `[]`         amm
///   1. `[]`         pool
///   2. `[]`         pool authority
///   3. `[signer]`   trader
///   4. `[]`         mint A
///   5. `[]`         mint B
///   6. `[writable]` pool's token A account
///   7. `[writable]` pool's token B account
///   8. `[writable]` trader's token A account
///   9. `[writable]` trader's token B account
///  10. `[]`         SPL Token program
///
/// Instruction data: `[swap_a: u8, input_amount: u64 (LE), min_output_amount: u64 (LE)]`
/// where a non-zero `swap_a` means "pay in A, receive B".
pub fn swap_exact_tokens_for_tokens(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [amm, pool, pool_authority, trader, mint_a, mint_b, pool_account_a, pool_account_b, trader_account_a, trader_account_b, _token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !trader.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !amm.owned_by(program_id) {
        return Err(SwapError::InvalidAccountData.into());
    }

    let swap_a = *data.first().ok_or(ProgramError::InvalidInstructionData)? != 0;
    let input_amount = u64::from_le_bytes(
        data.get(1..9)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let min_output_amount = u64::from_le_bytes(
        data.get(9..17)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    let seeds = PoolSeeds::load(program_id, pool, pool_authority, mint_a, mint_b, pool_account_a, pool_account_b)?;

    // The pool records which AMM it belongs to, so the fee cannot be swapped
    // for a cheaper one by passing a different AMM account.
    let config = read_amm(&amm.try_borrow()?)?;
    let fee = config.fee;
    expect_pda(program_id, amm, &[&config.id])?;
    if amm.address().as_ref() != seeds.amm {
        return Err(SwapError::InvalidSeeds.into());
    }
    if fee >= MAX_FEE_BASIS_POINTS {
        return Err(SwapError::InvalidFee.into());
    }

    // Never take more than the trader holds.
    let held = if swap_a {
        token_amount(&trader_account_a.try_borrow()?)?
    } else {
        token_amount(&trader_account_b.try_borrow()?)?
    };
    let input = input_amount.min(held);

    let fee_amount = mul_div(input, fee as u64, MAX_FEE_BASIS_POINTS as u64)?;
    let taxed_input = input.checked_sub(fee_amount).ok_or(SwapError::MathOverflow)?;

    let pool_a = token_amount(&pool_account_a.try_borrow()?)?;
    let pool_b = token_amount(&pool_account_b.try_borrow()?)?;

    // Constant product: the output is what keeps `a * b` from falling once the
    // taxed input is added to the paying side.
    let output = if swap_a {
        mul_div(taxed_input, pool_b, pool_a.checked_add(taxed_input).ok_or(SwapError::MathOverflow)?)?
    } else {
        mul_div(taxed_input, pool_a, pool_b.checked_add(taxed_input).ok_or(SwapError::MathOverflow)?)?
    };

    if output < min_output_amount {
        return Err(SwapError::OutputTooSmall.into());
    }

    let invariant = (pool_a as u128).checked_mul(pool_b as u128).ok_or(SwapError::MathOverflow)?;

    let bump = [seeds.authority_bump];
    let authority_seeds = seeds.authority_seeds(&bump);
    let signer = [Signer::from(&authority_seeds)];

    if swap_a {
        Transfer::<&AccountView> {
            from: trader_account_a,
            to: pool_account_a,
            authority: trader,
            amount: input,
            multisig_signers: &[],
        }
        .invoke()?;
        Transfer::<&AccountView> {
            from: pool_account_b,
            to: trader_account_b,
            authority: pool_authority,
            amount: output,
            multisig_signers: &[],
        }
        .invoke_signed(&signer)?;
    } else {
        Transfer::<&AccountView> {
            from: trader_account_b,
            to: pool_account_b,
            authority: trader,
            amount: input,
            multisig_signers: &[],
        }
        .invoke()?;
        Transfer::<&AccountView> {
            from: pool_account_a,
            to: trader_account_a,
            authority: pool_authority,
            amount: output,
            multisig_signers: &[],
        }
        .invoke_signed(&signer)?;
    }

    log!("Traded {} in for {} out", input, output);

    // Re-read after the CPIs. A higher invariant is fine — that is rounding in
    // the pool's favour — but it must never fall.
    let new_a = token_amount(&pool_account_a.try_borrow()?)?;
    let new_b = token_amount(&pool_account_b.try_borrow()?)?;
    let new_invariant = (new_a as u128).checked_mul(new_b as u128).ok_or(SwapError::MathOverflow)?;
    if invariant > new_invariant {
        return Err(SwapError::InvariantViolated.into());
    }

    Ok(())
}
