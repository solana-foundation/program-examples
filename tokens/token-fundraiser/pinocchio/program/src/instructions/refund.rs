use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::{
    error::FundraiserError,
    instructions::days_elapsed,
    state::{Contributor, Fundraiser},
};

/// Refunds a contributor once the fundraiser has ended without meeting its
/// target, returning their contribution and closing their contributor account.
///
/// Accounts:
///   0. `[signer, writable]` contributor (receives the refund and reclaimed rent)
///   1. `[]`                 maker (part of the fundraiser PDA seeds)
///   2. `[]`                 mint to raise
///   3. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`)
///   4. `[writable]`         contributor account (PDA, closed here)
///   5. `[writable]`         contributor's token account (destination)
///   6. `[writable]`         vault (fundraiser PDA's token account)
///   7. `[]`                 token program
///
/// Instruction data: none.
pub fn refund(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [contributor, maker, mint_to_raise, fundraiser, contributor_account, contributor_ata, vault, _token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !contributor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut state = Fundraiser::deserialize(&fundraiser.try_borrow()?)?;

    // The fundraiser PDA is derived from the maker; confirm both, and the vault.
    if &state.maker != maker.address().as_array() || &state.mint_to_raise != mint_to_raise.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }
    let bump_bytes = [state.bump];
    let fundraiser_pda =
        Address::create_program_address(&[Fundraiser::SEED_PREFIX, maker.address().as_ref(), &bump_bytes], program_id)
            .map_err(|_| ProgramError::InvalidSeeds)?;
    if fundraiser.address() != &fundraiser_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_vault, _) = Address::find_program_address(
        &[fundraiser.address().as_ref(), pinocchio_token::ID.as_ref(), mint_to_raise.address().as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if vault.address() != &expected_vault {
        return Err(ProgramError::InvalidAccountData);
    }

    // Refunds are only allowed once the fundraiser has ended without meeting its target.
    if days_elapsed(state.time_started)? < state.duration as i64 {
        return Err(FundraiserError::FundraiserNotEnded.into());
    }
    // Eligibility reads the recorded total, not the vault balance, so an
    // unrecorded direct transfer into the vault cannot block legitimate refunds.
    if state.current_amount >= state.amount_to_raise {
        return Err(FundraiserError::TargetMet.into());
    }

    // Confirm the contributor account is the canonical PDA before trusting it.
    let contributor_state = Contributor::deserialize(&contributor_account.try_borrow()?)?;
    let (contributor_pda, _) = Address::find_program_address(
        &[Contributor::SEED_PREFIX, fundraiser.address().as_ref(), contributor.address().as_ref()],
        program_id,
    );
    if contributor_account.address() != &contributor_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Return the contribution, signed by the fundraiser PDA.
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.address().as_ref()), Seed::from(&bump_bytes)];
    log!("Refunding contributor");
    Transfer {
        from: vault,
        to: contributor_ata,
        authority: fundraiser,
        multisig_signers: &[] as &[&AccountView],
        amount: contributor_state.amount,
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    // Reduce the recorded total and close the contributor account.
    state.current_amount = state.current_amount.saturating_sub(contributor_state.amount);
    state.serialize(&mut fundraiser.try_borrow_mut()?)?;

    log!("Closing contributor account");
    let new_contributor_lamports = contributor.lamports() + contributor_account.lamports();
    contributor.set_lamports(new_contributor_lamports);
    contributor_account.close()?;

    log!("Refund complete");
    Ok(())
}
