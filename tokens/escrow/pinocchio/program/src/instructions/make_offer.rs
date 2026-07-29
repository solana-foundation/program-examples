use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer;

use crate::{instructions::read_u64, state::Offer};

/// Creates an offer: the maker deposits `token_a_offered_amount` of token A into
/// a vault owned by the offer PDA, recording how much token B they want back.
///
/// Accounts:
///   0. `[writable]`         offer account (PDA `[b"offer", maker, id]`, created here)
///   1. `[]`                 token mint A (deposited token)
///   2. `[]`                 token mint B (requested token)
///   3. `[writable]`         maker's token A account (source of the deposit)
///   4. `[writable]`         vault (offer PDA's associated token account for mint A, created here)
///   5. `[signer, writable]` maker
///   6. `[signer, writable]` payer (funds the offer account and the vault)
///   7. `[]`                 token program
///   8. `[]`                 associated token program
///   9. `[]`                 system program
///
/// Instruction data: `[id: u64 (LE), token_a_offered_amount: u64 (LE),
///                     token_b_wanted_amount: u64 (LE), bump: u8]`
pub fn make_offer(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [offer_account, token_mint_a, token_mint_b, maker_token_account_a, vault, maker, payer, token_program, _associated_token_program, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let id = read_u64(data, 0)?;
    let token_a_offered_amount = read_u64(data, 8)?;
    let token_b_wanted_amount = read_u64(data, 16)?;
    let bump = *data.get(24).ok_or(ProgramError::InvalidInstructionData)?;

    // Verify the supplied offer account is the canonical PDA for these seeds.
    let id_bytes = id.to_le_bytes();
    let bump_bytes = [bump];
    let offer_pda = Address::create_program_address(
        &[Offer::SEED_PREFIX, maker.address().as_ref(), &id_bytes, &bump_bytes],
        program_id,
    )
    .map_err(|_| ProgramError::InvalidSeeds)?;
    if offer_account.address() != &offer_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the offer account, signed by the offer PDA itself.
    let lamports = Rent::get()?.try_minimum_balance(Offer::LEN)?;
    let seeds = [
        Seed::from(Offer::SEED_PREFIX),
        Seed::from(maker.address().as_ref()),
        Seed::from(&id_bytes),
        Seed::from(&bump_bytes),
    ];
    let signers = [Signer::from(&seeds)];

    log!("Creating offer account");
    CreateAccount { from: payer, to: offer_account, lamports, space: Offer::LEN as u64, owner: program_id }
        .invoke_signed(&signers)?;

    // Create the vault: an associated token account for mint A owned by the offer PDA.
    log!("Creating vault");
    CreateIdempotent {
        funding_account: payer,
        account: vault,
        wallet: offer_account,
        mint: token_mint_a,
        system_program,
        token_program,
    }
    .invoke()?;

    // Move the maker's tokens into the vault.
    log!("Depositing tokens into vault");
    Transfer {
        from: maker_token_account_a,
        to: vault,
        authority: maker,
        multisig_signers: &[] as &[&AccountView],
        amount: token_a_offered_amount,
    }
    .invoke()?;

    // Persist the offer terms.
    let offer = Offer {
        id,
        maker: *maker.address().as_array(),
        token_mint_a: *token_mint_a.address().as_array(),
        token_mint_b: *token_mint_b.address().as_array(),
        token_b_wanted_amount,
        bump,
    };
    offer.serialize(&mut offer_account.try_borrow_mut()?)?;

    log!("Offer created successfully");
    Ok(())
}
