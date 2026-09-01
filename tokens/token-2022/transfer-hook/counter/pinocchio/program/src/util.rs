//! Shared account-creation helper.

use pinocchio::{
    cpi::{Seed, Signer},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, Transfer};

/// Creates `account` at a PDA, tolerating an address that already holds
/// lamports.
///
/// `CreateAccount` fails outright if the target has a balance, and every PDA
/// here has a publicly derivable address — so anyone could send one lamport to
/// one of these addresses and permanently block the instruction that was
/// meant to create it. Topping the account up and then allocating and assigning
/// it separately sidesteps that; it is the same fallback Anchor's `init`
/// performs.
pub fn create_pda_account(
    payer: &AccountView,
    account: &mut AccountView,
    space: usize,
    owner: &Address,
    seeds: &[Seed],
) -> ProgramResult {
    let required = Rent::get()?.try_minimum_balance(space)?;
    let current = account.lamports();

    if current < required {
        Transfer { from: payer, to: account, lamports: required - current }.invoke()?;
    }

    let signer = [Signer::from(seeds)];
    Allocate { account, space: space as u64 }.invoke_signed(&signer)?;
    Assign { account, owner }.invoke_signed(&signer)?;

    Ok(())
}
