use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::{instructions::TransferChecked, state::Mint};

use crate::{
    error::FundraiserError,
    instructions::{assert_associated_token_account, assert_fundraiser_pda, elapsed_days, max_contribution, read_u64},
    state::{Contributor, Fundraiser},
};

/// Contributes tokens to an open campaign, creating the contributor's running
/// total on first use.
///
/// Accounts:
///   0. `[signer, writable]` contributor (funds the contributor account)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`)
///   3. `[writable]`         contributor account (PDA `[b"contributor", fundraiser, contributor]`)
///   4. `[writable]`         contributor's associated token account (source)
///   5. `[writable]`         vault (fundraiser PDA's associated token account)
///   6. `[]`                 token program
///   7. `[]`                 system program
///
/// Instruction data: `[amount: u64 (LE), contributor_bump: u8]`
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
    let contributor_bump = *data.get(8).ok_or(ProgramError::InvalidInstructionData)?;

    // Load the campaign terms (the borrow is released at the block's end).
    let mut state = {
        let fundraiser_data = fundraiser.try_borrow()?;
        Fundraiser::deserialize(&fundraiser_data)?
    };

    // The fundraiser PDA is keyed by its maker, which the state records.
    let maker = Address::from(state.maker);
    assert_fundraiser_pda(fundraiser, &state, &maker, program_id)?;

    // Contributions must be in the campaign's mint.
    if &state.mint_to_raise != mint_to_raise.address().as_array() {
        return Err(FundraiserError::InvalidAccount.into());
    }

    let decimals = Mint::from_account_view(mint_to_raise)?.decimals();

    if amount == 0 {
        return Err(FundraiserError::ContributionTooSmall.into());
    }

    // No single contributor may supply more than their share of the target.
    let cap = max_contribution(state.amount_to_raise)?;
    if amount > cap {
        return Err(FundraiserError::ContributionTooBig.into());
    }

    // The campaign must still be running.
    let elapsed = elapsed_days(Clock::get()?.unix_timestamp, state.time_started)?;
    if (state.duration as i64) <= elapsed {
        return Err(FundraiserError::FundraiserEnded.into());
    }

    // Both token accounts must be the canonical ATAs, so contributions can only
    // come from the signer's own account and can only land in the real vault.
    assert_associated_token_account(vault, fundraiser.address(), mint_to_raise.address())?;
    assert_associated_token_account(contributor_ata, contributor.address(), mint_to_raise.address())?;

    // Verify the contributor account is the canonical PDA for these seeds.
    let bump_bytes = [contributor_bump];
    let seeds = [
        Seed::from(Contributor::SEED_PREFIX),
        Seed::from(fundraiser.address().as_ref()),
        Seed::from(contributor.address().as_ref()),
        Seed::from(&bump_bytes),
    ];
    let contributor_pda = Address::create_program_address(
        &[Contributor::SEED_PREFIX, fundraiser.address().as_ref(), contributor.address().as_ref(), &bump_bytes],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if contributor_account.address() != &contributor_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the contributor's running total on their first contribution. This
    // is the Pinocchio equivalent of Anchor's `init_if_needed`.
    if contributor_account.is_data_empty() {
        log!("Creating contributor account");
        let lamports = Rent::get()?.try_minimum_balance(Contributor::LEN)?;
        let signers = [Signer::from(&seeds)];
        CreateAccount {
            from: contributor,
            to: contributor_account,
            lamports,
            space: Contributor::LEN as u64,
            owner: program_id,
        }
        .invoke_signed(&signers)?;
    } else if !contributor_account.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountOwner);
    }

    let mut contributed = {
        let contributor_data = contributor_account.try_borrow()?;
        Contributor::deserialize(&contributor_data)?
    };

    // Their running total, including this contribution, must stay under the cap.
    let new_total = contributed.amount.checked_add(amount).ok_or(FundraiserError::ArithmeticOverflow)?;
    if new_total > cap {
        return Err(FundraiserError::MaximumContributionsReached.into());
    }

    // Move the tokens into the vault. `TransferChecked` makes the token program
    // verify the mint and decimals rather than trusting the caller's accounts.
    log!("Transferring contribution to vault");
    TransferChecked {
        from: contributor_ata,
        mint: mint_to_raise,
        to: vault,
        authority: contributor,
        multisig_signers: &[] as &[&AccountView],
        amount,
        decimals,
    }
    .invoke()?;

    // Record the contribution on both the campaign and the contributor.
    state.current_amount = state.current_amount.checked_add(amount).ok_or(FundraiserError::ArithmeticOverflow)?;
    state.serialize(&mut fundraiser.try_borrow_mut()?)?;

    contributed.amount = new_total;
    contributed.serialize(&mut contributor_account.try_borrow_mut()?)?;

    log!("Contribution recorded");
    Ok(())
}
