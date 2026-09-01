use pinocchio::{cpi::Signer, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::instructions::{MintTo, Transfer};

use crate::{
    error::SwapError,
    instructions::{mul_div, PoolSeeds},
    state::{token_amount, MINIMUM_LIQUIDITY},
};

/// Adds liquidity, minting LP tokens in return.
///
/// Deposits must match the pool's current ratio, so the depositor cannot move
/// the price by adding lopsided amounts: whichever side is short decides how
/// much of the other side is actually taken.
///
/// Accounts:
///   0. `[]`                 pool
///   1. `[]`                 pool authority
///   2. `[signer]`           depositor
///   3. `[writable]`         liquidity mint
///   4. `[]`                 mint A
///   5. `[]`                 mint B
///   6. `[writable]`         pool's token A account
///   7. `[writable]`         pool's token B account
///   8. `[writable]`         depositor's LP token account
///   9. `[writable]`         depositor's token A account
///  10. `[writable]`         depositor's token B account
///  11. `[signer, writable]` payer
///  12. `[]`                 system program
///  13. `[]`                 SPL Token program
///  14. `[]`                 associated token program
///
/// Instruction data: `[amount_a: u64 (LE), amount_b: u64 (LE)]`
pub fn deposit_liquidity(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [pool, pool_authority, depositor, mint_liquidity, mint_a, mint_b, pool_account_a, pool_account_b, depositor_account_liquidity, depositor_account_a, depositor_account_b, payer, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !depositor.is_signer() || !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let requested_a = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let requested_b = u64::from_le_bytes(
        data.get(8..16)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    let seeds = PoolSeeds::load(program_id, pool, pool_authority, mint_a, mint_b, pool_account_a, pool_account_b)?;
    seeds.check_liquidity_mint(program_id, mint_liquidity)?;

    // Never take more than the depositor holds.
    let mut amount_a = requested_a.min(token_amount(&depositor_account_a.try_borrow()?)?);
    let mut amount_b = requested_b.min(token_amount(&depositor_account_b.try_borrow()?)?);

    let pool_a = token_amount(&pool_account_a.try_borrow()?)?;
    let pool_b = token_amount(&pool_account_b.try_borrow()?)?;
    let pool_creation = pool_a == 0 && pool_b == 0;

    if !pool_creation {
        // Match the existing ratio, limited by whichever side is short.
        let b_required = mul_div(amount_a, pool_b, pool_a)?;
        if b_required <= amount_b {
            amount_b = b_required;
        } else {
            amount_a = mul_div(amount_b, pool_a, pool_b)?;
        }
    }

    // Shares are the geometric mean of the deposit, so they track the pool's
    // value rather than either side's balance.
    let mut liquidity =
        u64::try_from((amount_a as u128).checked_mul(amount_b as u128).ok_or(SwapError::MathOverflow)?.isqrt())
            .map_err(|_| SwapError::MathOverflow)?;

    if pool_creation {
        // Burn a slice of the very first deposit permanently. Without it the
        // pool could be emptied and its share price then trivially skewed.
        if liquidity < MINIMUM_LIQUIDITY {
            return Err(SwapError::DepositTooSmall.into());
        }
        liquidity -= MINIMUM_LIQUIDITY;
    }

    Transfer::<&AccountView> {
        from: depositor_account_a,
        to: pool_account_a,
        authority: depositor,
        amount: amount_a,
        multisig_signers: &[],
    }
    .invoke()?;
    Transfer::<&AccountView> {
        from: depositor_account_b,
        to: pool_account_b,
        authority: depositor,
        amount: amount_b,
        multisig_signers: &[],
    }
    .invoke()?;

    CreateIdempotent {
        funding_account: payer,
        account: depositor_account_liquidity,
        wallet: depositor,
        mint: mint_liquidity,
        system_program,
        token_program,
    }
    .invoke()?;

    let bump = [seeds.authority_bump];
    let authority_seeds = seeds.authority_seeds(&bump);

    MintTo::<&AccountView> {
        mint: mint_liquidity,
        account: depositor_account_liquidity,
        mint_authority: pool_authority,
        amount: liquidity,
        multisig_signers: &[],
    }
    .invoke_signed(&[Signer::from(&authority_seeds)])?;

    log!("Deposited liquidity");
    Ok(())
}
