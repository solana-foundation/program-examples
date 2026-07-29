use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::{instructions::CloseAccount, instructions::Transfer, state::Account as TokenAccount};

use crate::state::Offer;

/// Takes an open offer: the taker sends the maker the requested token B and
/// receives the vaulted token A in return. The vault and offer accounts are
/// then closed.
///
/// Accounts:
///   0. `[writable]`         offer account (PDA `[b"offer", maker, id]`, closed here)
///   1. `[]`                 token mint A
///   2. `[]`                 token mint B
///   3. `[writable]`         maker's token B account (created if needed)
///   4. `[writable]`         taker's token A account (created if needed)
///   5. `[writable]`         taker's token B account (source of the payment)
///   6. `[writable]`         vault (offer PDA's token A account, drained and closed)
///   7. `[]`                 maker (receives token B)
///   8. `[signer, writable]` taker
///   9. `[signer, writable]` payer (funds token accounts created here; reclaims the offer rent)
///  10. `[]`                 token program
///  11. `[]`                 associated token program
///  12. `[]`                 system program
///
/// Instruction data: none.
pub fn take_offer(program_id: &Address, accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [offer_account, token_mint_a, token_mint_b, maker_token_account_b, taker_token_account_a, taker_token_account_b, vault, maker, taker, payer, token_program, _associated_token_program, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !taker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load the recorded offer terms (the borrow is released at the block's end).
    let offer = {
        let offer_data = offer_account.try_borrow()?;
        Offer::deserialize(&offer_data)?
    };

    // The provided accounts must match what the offer recorded.
    if &offer.maker != maker.address().as_array()
        || &offer.token_mint_a != token_mint_a.address().as_array()
        || &offer.token_mint_b != token_mint_b.address().as_array()
    {
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

    // Make sure both recipients have token accounts to receive into.
    log!("Ensuring taker token A account exists");
    CreateIdempotent {
        funding_account: payer,
        account: taker_token_account_a,
        wallet: taker,
        mint: token_mint_a,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Ensuring maker token B account exists");
    CreateIdempotent {
        funding_account: payer,
        account: maker_token_account_b,
        wallet: maker,
        mint: token_mint_b,
        system_program,
        token_program,
    }
    .invoke()?;

    let vault_amount = TokenAccount::from_account_view(vault)?.amount();

    // Taker pays the maker the requested token B.
    log!("Sending token B from taker to maker");
    Transfer {
        from: taker_token_account_b,
        to: maker_token_account_b,
        authority: taker,
        multisig_signers: &[] as &[&AccountView],
        amount: offer.token_b_wanted_amount,
    }
    .invoke()?;

    // Release the vaulted token A to the taker, signed by the offer PDA.
    let seeds = [
        Seed::from(Offer::SEED_PREFIX),
        Seed::from(maker.address().as_ref()),
        Seed::from(&id_bytes),
        Seed::from(&bump_bytes),
    ];
    let signers = [Signer::from(&seeds)];

    log!("Releasing token A from vault to taker");
    Transfer {
        from: vault,
        to: taker_token_account_a,
        authority: offer_account,
        multisig_signers: &[] as &[&AccountView],
        amount: vault_amount,
    }
    .invoke_signed(&signers)?;

    // Close the now-empty vault, returning its rent to the taker.
    log!("Closing vault");
    CloseAccount {
        account: vault,
        destination: taker,
        authority: offer_account,
        multisig_signers: &[] as &[&AccountView],
    }
    .invoke_signed(&signers)?;

    // Close the offer account, returning its rent to the payer that funded it.
    log!("Closing offer account");
    let new_payer_lamports = payer.lamports() + offer_account.lamports();
    payer.set_lamports(new_payer_lamports);
    offer_account.close()?;

    log!("Offer taken successfully");
    Ok(())
}
