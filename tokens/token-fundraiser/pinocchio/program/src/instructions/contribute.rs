use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

use crate::{
    error::FundraiserError,
    instructions::{days_elapsed, max_contribution, read_u64},
    state::{Contributor, Fundraiser},
};

/// Contributes `amount` of the raised token into the fundraiser's vault, up to a
/// per-contributor cap, while the fundraiser is still running.
///
/// Accounts:
///   0. `[signer, writable]` contributor (funds the contributor account; source authority)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`)
///   3. `[writable]`         contributor account (PDA `[b"contributor", fundraiser, contributor]`, created if needed)
///   4. `[writable]`         contributor's token account (source)
///   5. `[writable]`         vault (fundraiser PDA's token account)
///   6. `[]`                 token program
///   7. `[]`                 system program
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn contribute(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [contributor, mint_to_raise, fundraiser, contributor_account, contributor_ata, vault, _token_program, _system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !contributor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount = read_u64(data, 0)?;

    let mut state = Fundraiser::deserialize(&fundraiser.try_borrow()?)?;

    // Confirm the fundraiser PDA and that the vault is its associated token account.
    let fundraiser_bump = [state.bump];
    let fundraiser_pda =
        Address::create_program_address(&[Fundraiser::SEED_PREFIX, state.maker.as_ref(), &fundraiser_bump], program_id)
            .map_err(|_| ProgramError::InvalidSeeds)?;
    if fundraiser.address() != &fundraiser_pda || &state.mint_to_raise != mint_to_raise.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }
    let (expected_vault, _) = Address::find_program_address(
        &[fundraiser.address().as_ref(), pinocchio_token::ID.as_ref(), mint_to_raise.address().as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if vault.address() != &expected_vault {
        return Err(ProgramError::InvalidAccountData);
    }

    // Contribution bounds: at least one base unit, at most the per-contributor cap.
    if amount == 0 {
        return Err(FundraiserError::ContributionTooSmall.into());
    }
    let cap = max_contribution(state.amount_to_raise);
    if amount > cap {
        return Err(FundraiserError::ContributionTooBig.into());
    }

    // The fundraiser must still be running.
    if days_elapsed(state.time_started)? >= state.duration as i64 {
        return Err(FundraiserError::FundraiserEnded.into());
    }

    // Bind the contributor record to this signer before trusting it, whether it
    // already exists or is about to be created.
    //
    // The bump is derived here rather than taken from the caller: several bumps
    // can yield a valid address for the same seeds, so accepting one would let a
    // contributor open a second, non-canonical record and be metered against the
    // cap separately on each. `refund` only ever derives the canonical address,
    // so those extra records would also be unrefundable.
    let (contributor_pda, contributor_bump) = Address::find_program_address(
        &[Contributor::SEED_PREFIX, fundraiser.address().as_ref(), contributor.address().as_ref()],
        program_id,
    );
    let bump_bytes = [contributor_bump];
    let seeds = [
        Seed::from(Contributor::SEED_PREFIX),
        Seed::from(fundraiser.address().as_ref()),
        Seed::from(contributor.address().as_ref()),
        Seed::from(&bump_bytes),
    ];
    if contributor_account.address() != &contributor_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the per-contributor record on first contribution; otherwise load it.
    let already_contributed = if contributor_account.owner() == program_id {
        Contributor::deserialize(&contributor_account.try_borrow()?)?.amount
    } else {
        log!("Creating contributor account");
        let lamports = Rent::get()?.try_minimum_balance(Contributor::LEN)?;
        CreateAccount {
            from: contributor,
            to: contributor_account,
            lamports,
            space: Contributor::LEN as u64,
            owner: program_id,
        }
        .invoke_signed(&[Signer::from(&seeds)])?;
        0
    };

    // Enforce the per-contributor cap across this contributor's total.
    let new_total = already_contributed.checked_add(amount).ok_or(FundraiserError::ContributionTooBig)?;
    if new_total > cap {
        return Err(FundraiserError::MaximumContributionsReached.into());
    }

    // Move the tokens into the vault, then record the contribution.
    log!("Transferring contribution to vault");
    Transfer {
        from: contributor_ata,
        to: vault,
        authority: contributor,
        multisig_signers: &[] as &[&AccountView],
        amount,
    }
    .invoke()?;

    state.current_amount = state.current_amount.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    state.serialize(&mut fundraiser.try_borrow_mut()?)?;

    Contributor { amount: new_total }.serialize(&mut contributor_account.try_borrow_mut()?)?;

    log!("Contribution recorded");
    Ok(())
}
