mod create_amm;
mod create_pool;
mod deposit_liquidity;
mod swap_exact_tokens_for_tokens;
mod withdraw_liquidity;

pub use create_amm::*;
pub use create_pool::*;
pub use deposit_liquidity::*;
pub use swap_exact_tokens_for_tokens::*;
pub use withdraw_liquidity::*;

use pinocchio::{cpi::Seed, AccountView, Address};

use crate::{
    error::SwapError,
    state::{read_pool, AUTHORITY_SEED, LIQUIDITY_SEED},
};

/// The legacy SPL Token program ID (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).
pub const SPL_TOKEN_PROGRAM_ID: Address =
    pinocchio::Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// The associated token program ID (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`).
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Address =
    pinocchio::Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Derives `owner`'s associated token account for `mint`.
///
/// The associated token program seeds its accounts `[owner, token program,
/// mint]`, so this reproduces the one canonical address for that pair.
pub fn associated_token_address(owner: &Address, mint: &Address) -> Address {
    let (address, _) = Address::find_program_address(
        &[owner.as_ref(), SPL_TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    address
}

/// The pool's PDAs, all seeded from the same three addresses.
pub struct PoolSeeds {
    pub amm: [u8; 32],
    pub mint_a: [u8; 32],
    pub mint_b: [u8; 32],
    pub authority_bump: u8,
}

impl PoolSeeds {
    /// Reads the pool account and rederives everything the pool owns, checking
    /// each account the caller supplied against the derivation.
    ///
    /// The pool records which mints it is for, and both vaults are the
    /// authority's associated token accounts for those mints. Rederiving them
    /// is what the Anchor version gets from its `associated_token::mint` and
    /// `associated_token::authority` constraints — without it a caller can hand
    /// over a vault of their own choosing, which is enough to misprice a trade
    /// or mint LP shares against reserves the pool never received.
    pub fn load(
        program_id: &Address,
        pool: &AccountView,
        pool_authority: &AccountView,
        mint_a: &AccountView,
        mint_b: &AccountView,
        pool_account_a: &AccountView,
        pool_account_b: &AccountView,
    ) -> Result<Self, pinocchio::error::ProgramError> {
        if !pool.owned_by(program_id) {
            return Err(SwapError::InvalidAccountData.into());
        }

        let stored = read_pool(&pool.try_borrow()?)?;

        if stored.mint_a != mint_a.address().as_ref() || stored.mint_b != mint_b.address().as_ref() {
            return Err(SwapError::InvalidMint.into());
        }
        let amm = stored.amm;

        let (pool_address, _) =
            Address::find_program_address(&[&amm, mint_a.address().as_ref(), mint_b.address().as_ref()], program_id);
        if pool.address() != &pool_address {
            return Err(SwapError::InvalidSeeds.into());
        }

        let (authority_address, authority_bump) = Address::find_program_address(
            &[&amm, mint_a.address().as_ref(), mint_b.address().as_ref(), AUTHORITY_SEED],
            program_id,
        );
        if pool_authority.address() != &authority_address {
            return Err(SwapError::InvalidSeeds.into());
        }

        // Both vaults are the authority's associated token accounts. Their
        // balances price every trade and back every LP share, so a substituted
        // one is worth more than a wrong mint.
        if pool_account_a.address() != &associated_token_address(&authority_address, mint_a.address())
            || pool_account_b.address() != &associated_token_address(&authority_address, mint_b.address())
        {
            return Err(SwapError::InvalidSeeds.into());
        }

        Ok(Self { amm, mint_a: stored.mint_a, mint_b: stored.mint_b, authority_bump })
    }

    /// Confirms `mint_liquidity` is this pool's LP mint.
    ///
    /// Withdrawals divide by its supply and deposits mint from it, so an
    /// attacker-supplied mint would let them set their own entitlement.
    pub fn check_liquidity_mint(
        &self,
        program_id: &Address,
        mint_liquidity: &AccountView,
    ) -> Result<(), pinocchio::error::ProgramError> {
        let (address, _) =
            Address::find_program_address(&[&self.amm, &self.mint_a, &self.mint_b, LIQUIDITY_SEED], program_id);
        if mint_liquidity.address() != &address {
            return Err(SwapError::InvalidSeeds.into());
        }
        Ok(())
    }

    /// The signer seeds for the pool authority, which owns the pool's token
    /// accounts and the liquidity mint.
    pub fn authority_seeds<'a>(&'a self, bump: &'a [u8; 1]) -> [Seed<'a>; 5] {
        [
            Seed::from(&self.amm),
            Seed::from(&self.mint_a),
            Seed::from(&self.mint_b),
            Seed::from(AUTHORITY_SEED),
            Seed::from(bump),
        ]
    }
}

/// Confirms `account` is the PDA for `seeds`, returning its bump.
pub fn expect_pda(
    program_id: &Address,
    account: &AccountView,
    seeds: &[&[u8]],
) -> Result<u8, pinocchio::error::ProgramError> {
    let (address, bump) = Address::find_program_address(seeds, program_id);
    if account.address() != &address {
        return Err(SwapError::InvalidSeeds.into());
    }
    Ok(bump)
}

/// `a * b / c` in `u128`, so the product of two `u64` amounts cannot overflow.
pub fn mul_div(a: u64, b: u64, c: u64) -> Result<u64, pinocchio::error::ProgramError> {
    let result = (a as u128)
        .checked_mul(b as u128)
        .ok_or(SwapError::MathOverflow)?
        .checked_div(c as u128)
        .ok_or(SwapError::MathOverflow)?;
    u64::try_from(result).map_err(|_| SwapError::MathOverflow.into())
}
