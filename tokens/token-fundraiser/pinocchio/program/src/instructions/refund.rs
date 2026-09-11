use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{
    instructions::TransferChecked,
    state::{Account as TokenAccount, Mint},
};

use crate::{
    error::FundraiserError,
    instructions::{assert_associated_token_account, assert_fundraiser_pda, elapsed_days},
    state::{Contributor, Fundraiser},
};

/// Refunds a contributor after a campaign expired without reaching its target.
/// Returns exactly what this contributor put in and closes their contributor
/// account.
///
/// Accounts:
///   0. `[signer, writable]` contributor (receives the refund and the reclaimed rent)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`)
///   3. `[writable]`         contributor account (PDA `[b"contributor", fundraiser, contributor]`, closed here)
///   4. `[writable]`         contributor's associated token account (destination)
///   5. `[writable]`         vault (source of the refund)
///   6. `[]`                 token program
///
/// Instruction data: `[contributor_bump: u8]`
pub fn refund(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [contributor, mint_to_raise, fundraiser, contributor_account, contributor_ata, vault, _token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !contributor.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let contributor_bump = *data.first().ok_or(ProgramError::InvalidInstructionData)?;

    // Load the campaign terms (the borrow is released at the block's end).
    let mut state = {
        let fundraiser_data = fundraiser.try_borrow()?;
        Fundraiser::deserialize(&fundraiser_data)?
    };

    // The fundraiser PDA is keyed by its maker, which the state records.
    let maker = Address::from(state.maker);
    assert_fundraiser_pda(fundraiser, &state, &maker, program_id)?;

    if &state.mint_to_raise != mint_to_raise.address().as_array() {
        return Err(FundraiserError::InvalidAccount.into());
    }

    // Refunds only open once the campaign has run its course.
    let elapsed = elapsed_days(Clock::get()?.unix_timestamp, state.time_started)?;
    if (state.duration as i64) > elapsed {
        return Err(FundraiserError::FundraiserNotEnded.into());
    }

    // Both token accounts must be the canonical ATAs, so the refund can only
    // leave the real vault and can only land in the signer's own account.
    assert_associated_token_account(vault, fundraiser.address(), mint_to_raise.address())?;
    assert_associated_token_account(contributor_ata, contributor.address(), mint_to_raise.address())?;

    let decimals = Mint::from_account_view(mint_to_raise)?.decimals();
    let vault_amount = TokenAccount::from_account_view(vault)?.amount();

    // A campaign that hit its target belongs to the maker, not the contributors.
    if vault_amount >= state.amount_to_raise {
        return Err(FundraiserError::TargetMet.into());
    }

    // Verify the contributor account is the canonical PDA for these seeds, and
    // that this program actually owns it.
    let bump_bytes = [contributor_bump];
    let contributor_pda = Address::create_program_address(
        &[Contributor::SEED_PREFIX, fundraiser.address().as_ref(), contributor.address().as_ref(), &bump_bytes],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if contributor_account.address() != &contributor_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if !contributor_account.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let contributed = {
        let contributor_data = contributor_account.try_borrow()?;
        Contributor::deserialize(&contributor_data)?
    };

    // Return exactly what this contributor put in, signed by the fundraiser PDA.
    let fundraiser_bump_bytes = [state.bump];
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.as_ref()), Seed::from(&fundraiser_bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Refunding contribution");
    TransferChecked {
        from: vault,
        mint: mint_to_raise,
        to: contributor_ata,
        authority: fundraiser,
        multisig_signers: &[] as &[&AccountView],
        amount: contributed.amount,
        decimals,
    }
    .invoke_signed(&signers)?;

    // Drop the refunded amount from the campaign total.
    state.current_amount =
        state.current_amount.checked_sub(contributed.amount).ok_or(FundraiserError::ArithmeticOverflow)?;
    state.serialize(&mut fundraiser.try_borrow_mut()?)?;

    // Close the contributor account, returning its rent to the contributor.
    log!("Closing contributor account");
    let new_contributor_lamports = contributor
        .lamports()
        .checked_add(contributor_account.lamports())
        .ok_or(FundraiserError::ArithmeticOverflow)?;
    contributor.set_lamports(new_contributor_lamports);
    contributor_account.close()?;

    log!("Refund complete");
    Ok(())
}
