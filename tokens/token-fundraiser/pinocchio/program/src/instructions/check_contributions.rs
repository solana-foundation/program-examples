use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::{
    instructions::{CloseAccount, TransferChecked},
    state::{Account as TokenAccount, Mint},
};

use crate::{
    error::FundraiserError,
    instructions::{assert_associated_token_account, assert_fundraiser_pda},
    state::Fundraiser,
};

/// Settles a successful campaign: if the vault holds at least the target, the
/// whole balance goes to the maker and the vault and fundraiser accounts are
/// closed, returning their rent.
///
/// Accounts:
///   0. `[signer, writable]` maker (receives the raise and the reclaimed rent)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`, closed here)
///   3. `[writable]`         vault (drained and closed)
///   4. `[writable]`         maker's associated token account (created if needed)
///   5. `[]`                 token program
///   6. `[]`                 associated token program
///   7. `[]`                 system program
///
/// Instruction data: none.
pub fn check_contributions(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [maker, mint_to_raise, fundraiser, vault, maker_ata, token_program, _associated_token_program, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load the campaign terms (the borrow is released at the block's end).
    let state = {
        let fundraiser_data = fundraiser.try_borrow()?;
        Fundraiser::deserialize(&fundraiser_data)?
    };

    // Only the maker who opened the campaign may collect it, and only in the
    // campaign's own mint.
    if &state.maker != maker.address().as_array() || &state.mint_to_raise != mint_to_raise.address().as_array() {
        return Err(FundraiserError::InvalidAccount.into());
    }

    assert_fundraiser_pda(fundraiser, &state, maker.address(), program_id)?;

    // Verify the vault is the campaign's real vault, not a substitute token
    // account that also happens to be owned by the fundraiser PDA.
    assert_associated_token_account(vault, fundraiser.address(), mint_to_raise.address())?;

    let decimals = Mint::from_account_view(mint_to_raise)?.decimals();
    let vault_amount = TokenAccount::from_account_view(vault)?.amount();

    // The raise only pays out once it has actually hit its target.
    if vault_amount < state.amount_to_raise {
        return Err(FundraiserError::TargetNotMet.into());
    }

    // Make sure the maker has somewhere to receive the raise. The associated
    // token program checks this is the maker's canonical ATA.
    log!("Ensuring maker token account exists");
    CreateIdempotent {
        funding_account: maker,
        account: maker_ata,
        wallet: maker,
        mint: mint_to_raise,
        system_program,
        token_program,
    }
    .invoke()?;

    // Release the raise to the maker, signed by the fundraiser PDA.
    let bump_bytes = [state.bump];
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.address().as_ref()), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Releasing raise to maker");
    TransferChecked {
        from: vault,
        mint: mint_to_raise,
        to: maker_ata,
        authority: fundraiser,
        multisig_signers: &[] as &[&AccountView],
        amount: vault_amount,
        decimals,
    }
    .invoke_signed(&signers)?;

    // Close the now-empty vault, returning its rent to the maker.
    log!("Closing vault");
    CloseAccount {
        account: vault,
        destination: maker,
        authority: fundraiser,
        multisig_signers: &[] as &[&AccountView],
    }
    .invoke_signed(&signers)?;

    // Close the fundraiser account, returning its rent to the maker.
    log!("Closing fundraiser account");
    let new_maker_lamports =
        maker.lamports().checked_add(fundraiser.lamports()).ok_or(FundraiserError::ArithmeticOverflow)?;
    maker.set_lamports(new_maker_lamports);
    fundraiser.close()?;

    log!("Fundraiser settled successfully");
    Ok(())
}
