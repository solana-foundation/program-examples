use pinocchio::{cpi::Signer, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;
use pinocchio_token::instructions::{Burn, Transfer};

use crate::{
    error::SwapError,
    instructions::{mul_div, PoolSeeds},
    state::{mint_supply, token_amount, MINIMUM_LIQUIDITY},
};

/// Burns LP tokens and returns the depositor's share of both sides.
///
/// The share is measured against `supply + MINIMUM_LIQUIDITY`, because the
/// locked minimum was never minted to anyone but still backs the pool.
///
/// Accounts:
///   0. `[]`         pool
///   1. `[]`         pool authority
///   2. `[signer]`   depositor
///   3. `[writable]` liquidity mint
///   4. `[]`         mint A
///   5. `[]`         mint B
///   6. `[writable]` pool's token A account
///   7. `[writable]` pool's token B account
///   8. `[writable]` depositor's LP token account
///   9. `[writable]` depositor's token A account
///  10. `[writable]` depositor's token B account
///  11. `[]`         SPL Token program
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn withdraw_liquidity(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [pool, pool_authority, depositor, mint_liquidity, mint_a, mint_b, pool_account_a, pool_account_b, depositor_account_liquidity, depositor_account_a, depositor_account_b, _token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !depositor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    let seeds = PoolSeeds::load(program_id, pool, pool_authority, mint_a, mint_b, pool_account_a, pool_account_b)?;
    seeds.check_liquidity_mint(program_id, mint_liquidity)?;

    let supply = mint_supply(&mint_liquidity.try_borrow()?)?;
    let denominator = supply.checked_add(MINIMUM_LIQUIDITY).ok_or(SwapError::MathOverflow)?;

    let amount_a = mul_div(amount, token_amount(&pool_account_a.try_borrow()?)?, denominator)?;
    let amount_b = mul_div(amount, token_amount(&pool_account_b.try_borrow()?)?, denominator)?;

    let bump = [seeds.authority_bump];
    let authority_seeds = seeds.authority_seeds(&bump);
    let signer = [Signer::from(&authority_seeds)];

    Transfer::<&AccountView> {
        from: pool_account_a,
        to: depositor_account_a,
        authority: pool_authority,
        amount: amount_a,
        multisig_signers: &[],
    }
    .invoke_signed(&signer)?;
    Transfer::<&AccountView> {
        from: pool_account_b,
        to: depositor_account_b,
        authority: pool_authority,
        amount: amount_b,
        multisig_signers: &[],
    }
    .invoke_signed(&signer)?;

    // Burning last means an over-large `amount` fails here and rolls back the
    // transfers above, so the pool cannot be drained by asking for too much.
    Burn::<&AccountView> {
        mint: mint_liquidity,
        account: depositor_account_liquidity,
        authority: depositor,
        amount,
        multisig_signers: &[],
    }
    .invoke()?;

    log!("Withdrew liquidity");
    Ok(())
}
