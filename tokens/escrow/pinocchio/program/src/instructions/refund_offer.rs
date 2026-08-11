use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_token::{instructions::CloseAccount, instructions::Transfer, state::Account as TokenAccount};

use crate::state::Offer;

/// Refunds an open offer: the vaulted token A is returned to the maker and
/// the vault and offer accounts are closed. Only the maker who created the
/// offer may call this.
///
/// Accounts:
///   0. `[writable]`         offer account (PDA `[b"offer", maker, id]`, closed here)
///   1. `[]`                 token mint A
///   2. `[writable]`         maker's token A account (receives the refund)
///   3. `[writable]`         vault (offer PDA's token A account, drained and closed)
///   4. `[signer, writable]` maker
///   5. `[]`                 token program
///
/// Instruction data: none.
pub fn refund_offer(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [offer_account, token_mint_a, maker_token_account_a, vault, maker, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load the recorded offer terms (the borrow is released at the block's end).
    let offer = {
        let offer_data = offer_account.try_borrow()?;
        Offer::deserialize(&offer_data)?
    };

    // Only the maker who created the offer may refund it.
    if &offer.maker != maker.address().as_array() || &offer.token_mint_a != token_mint_a.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Re-derive the offer PDA from the stored bump and confirm it is genuine.
    let id_bytes = offer.id.to_le_bytes();
    let bump_bytes = [offer.bump];
    let offer_pda = Address::create_program_address(
        &[Offer::SEED_PREFIX, maker.address().as_ref(), &id_bytes, &bump_bytes],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if offer_account.address() != &offer_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Verify vault is the offer's actual vault, not a substitute token-A
    // account that also happens to be owned by the offer PDA.
    let (expected_vault, _) = Address::find_program_address(
        &[offer_account.address().as_ref(), pinocchio_token::ID.as_ref(), token_mint_a.address().as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if vault.address() != &expected_vault {
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify maker_token_account_a is the maker's actual associated token
    // account, not a substitute destination.
    let (expected_maker_token_account_a, _) = Address::find_program_address(
        &[maker.address().as_ref(), pinocchio_token::ID.as_ref(), token_mint_a.address().as_ref()],
        &pinocchio_associated_token_account::ID,
    );
    if maker_token_account_a.address() != &expected_maker_token_account_a {
        return Err(ProgramError::InvalidAccountData);
    }

    let vault_amount = TokenAccount::from_account_view(vault)?.amount();

    let seeds = [
        Seed::from(Offer::SEED_PREFIX),
        Seed::from(maker.address().as_ref()),
        Seed::from(&id_bytes),
        Seed::from(&bump_bytes),
    ];
    let signers = [Signer::from(&seeds)];

    // Return the vaulted token A to the maker.
    Transfer {
        from: vault,
        to: maker_token_account_a,
        authority: offer_account,
        multisig_signers: &[] as &[&AccountView],
        amount: vault_amount,
    }
    .invoke_signed(&signers)?;

    // Close the now-empty vault, returning its rent to the maker.
    CloseAccount {
        account: vault,
        destination: maker,
        authority: offer_account,
        multisig_signers: &[] as &[&AccountView],
    }
    .invoke_signed(&signers)?;

    // Close the offer account, returning its rent to the maker.
    let new_maker_lamports = maker.lamports() + offer_account.lamports();
    maker.set_lamports(new_maker_lamports);
    offer_account.close()?;

    Ok(())
}
