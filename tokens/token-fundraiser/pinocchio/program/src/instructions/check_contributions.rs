use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::{
    instructions::{CloseAccount, Transfer},
    state::Account as TokenAccount,
};

use crate::{error::FundraiserError, state::Fundraiser};

/// Releases the raised funds to the maker once the target is met, then closes
/// the vault and fundraiser accounts. Only the maker may call this.
///
/// Accounts:
///   0. `[signer, writable]` maker (receives the funds and reclaimed rent)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`, closed here)
///   3. `[writable]`         vault (fundraiser PDA's token account, drained and closed)
///   4. `[writable]`         maker's token account (destination, created if needed)
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

    let state = Fundraiser::deserialize(&fundraiser.try_borrow()?)?;

    // Only the maker who created this fundraiser may release the funds.
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

    // The target must have been reached by recorded contributions. The vault
    // balance itself is not the gate: anyone can transfer into a standard ATA,
    // and such unrecorded deposits must not release the fundraiser.
    let vault_amount = TokenAccount::from_account_view(vault)?.amount();
    if state.current_amount < state.amount_to_raise {
        return Err(FundraiserError::TargetNotMet.into());
    }

    // Ensure the maker has a token account to receive into.
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

    // Release the funds and tear down the vault, both signed by the fundraiser PDA.
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.address().as_ref()), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Releasing funds to maker");
    Transfer {
        from: vault,
        to: maker_ata,
        authority: fundraiser,
        multisig_signers: &[] as &[&AccountView],
        amount: vault_amount,
    }
    .invoke_signed(&signers)?;

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
    let new_maker_lamports = maker.lamports() + fundraiser.lamports();
    maker.set_lamports(new_maker_lamports);
    fundraiser.close()?;

    log!("Funds released");
    Ok(())
}
