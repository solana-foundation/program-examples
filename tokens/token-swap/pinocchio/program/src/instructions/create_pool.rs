use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_token::instructions::InitializeMint2;

use crate::{
    error::SwapError,
    instructions::expect_pda,
    state::{read_amm, write_pool, AUTHORITY_SEED, LIQUIDITY_DECIMALS, LIQUIDITY_SEED, MINT_SIZE, POOL_SIZE},
    util::create_pda_account,
};

/// Creates a pool for a mint pair under an existing AMM.
///
/// Everything the pool owns hangs off one authority PDA — the two vaults and
/// the liquidity mint — so the program can move pool funds without any wallet
/// holding that power.
///
/// Accounts:
///   0. `[]`                 amm (PDA `[id]`)
///   1. `[writable]`         pool (PDA `[amm, mint_a, mint_b]`)
///   2. `[]`                 pool authority (PDA `[amm, mint_a, mint_b, b"authority"]`)
///   3. `[writable]`         liquidity mint (PDA `[amm, mint_a, mint_b, b"liquidity"]`)
///   4. `[]`                 mint A
///   5. `[]`                 mint B
///   6. `[writable]`         pool's token A account (ATA of the authority)
///   7. `[writable]`         pool's token B account (ATA of the authority)
///   8. `[signer, writable]` payer
///   9. `[]`                 system program
///  10. `[]`                 SPL Token program
///  11. `[]`                 associated token program
///
/// Instruction data: none beyond the discriminator.
pub fn create_pool(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [amm, pool, pool_authority, mint_liquidity, mint_a, mint_b, pool_account_a, pool_account_b, payer, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !amm.owned_by(program_id) {
        return Err(SwapError::InvalidAccountData.into());
    }

    // The AMM's id is its own seed, so rederiving from the stored id proves the
    // account really is an AMM this program created.
    let id = read_amm(&amm.try_borrow()?)?.id;
    expect_pda(program_id, amm, &[&id])?;

    let amm_key = *amm.address();
    let a = *mint_a.address();
    let b = *mint_b.address();

    let pool_bump = expect_pda(program_id, pool, &[amm_key.as_ref(), a.as_ref(), b.as_ref()])?;
    expect_pda(program_id, pool_authority, &[amm_key.as_ref(), a.as_ref(), b.as_ref(), AUTHORITY_SEED])?;
    let liquidity_bump =
        expect_pda(program_id, mint_liquidity, &[amm_key.as_ref(), a.as_ref(), b.as_ref(), LIQUIDITY_SEED])?;

    log!("Creating pool");
    let pool_bump_bytes = [pool_bump];
    let pool_seeds =
        [Seed::from(amm_key.as_ref()), Seed::from(a.as_ref()), Seed::from(b.as_ref()), Seed::from(&pool_bump_bytes)];
    create_pda_account(payer, pool, POOL_SIZE, program_id, &pool_seeds)?;
    write_pool(&mut pool.try_borrow_mut()?, &amm_key, &a, &b)?;

    log!("Creating liquidity mint");
    let liquidity_bump_bytes = [liquidity_bump];
    let liquidity_seeds = [
        Seed::from(amm_key.as_ref()),
        Seed::from(a.as_ref()),
        Seed::from(b.as_ref()),
        Seed::from(LIQUIDITY_SEED),
        Seed::from(&liquidity_bump_bytes),
    ];
    create_pda_account(payer, mint_liquidity, MINT_SIZE, token_program.address(), &liquidity_seeds)?;
    InitializeMint2 {
        mint: mint_liquidity,
        decimals: LIQUIDITY_DECIMALS,
        mint_authority: pool_authority.address(),
        freeze_authority: None,
    }
    .invoke()?;

    log!("Creating pool vaults");
    Create {
        funding_account: payer,
        account: pool_account_a,
        wallet: pool_authority,
        mint: mint_a,
        system_program,
        token_program,
    }
    .invoke()?;
    Create {
        funding_account: payer,
        account: pool_account_b,
        wallet: pool_authority,
        mint: mint_b,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Pool created");
    Ok(())
}
