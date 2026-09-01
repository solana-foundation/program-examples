use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::FundraiserError,
    instructions::{mint_decimals, read_u16, read_u64, MIN_AMOUNT_TO_RAISE},
    state::Fundraiser,
};

/// Starts a fundraiser: creates the fundraiser PDA state account and its vault
/// token account, which will hold contributed tokens until the target is met.
///
/// Accounts:
///   0. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`, created here)
///   1. `[]`                 mint to raise
///   2. `[writable]`         vault (fundraiser PDA's associated token account, created here)
///   3. `[signer, writable]` maker (funds the accounts; receives the funds)
///   4. `[]`                 token program
///   5. `[]`                 associated token program
///   6. `[]`                 system program
///
/// Instruction data: `[amount: u64 (LE), duration: u16 (LE), bump: u8]`
pub fn initialize(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [fundraiser, mint_to_raise, vault, maker, token_program, _associated_token_program, system_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount = read_u64(data, 0)?;
    let duration = read_u16(data, 8)?;
    let bump = *data.get(10).ok_or(ProgramError::InvalidInstructionData)?;

    // The target must clear the minimum, scaled by the mint's decimals.
    let decimals = mint_decimals(mint_to_raise)?;
    let minimum = MIN_AMOUNT_TO_RAISE.checked_pow(decimals as u32).ok_or(FundraiserError::InvalidAmount)?;
    if amount < minimum {
        return Err(FundraiserError::InvalidAmount.into());
    }

    // Confirm the supplied account is the canonical fundraiser PDA.
    let bump_bytes = [bump];
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.address().as_ref()), Seed::from(&bump_bytes)];
    let fundraiser_pda =
        Address::create_program_address(&[Fundraiser::SEED_PREFIX, maker.address().as_ref(), &bump_bytes], program_id)
            .map_err(|_| ProgramError::InvalidSeeds)?;
    if fundraiser.address() != &fundraiser_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the fundraiser state account, signed by the PDA itself.
    log!("Creating fundraiser account");
    let lamports = Rent::get()?.try_minimum_balance(Fundraiser::LEN)?;
    let signers = [Signer::from(&seeds)];
    CreateAccount { from: maker, to: fundraiser, lamports, space: Fundraiser::LEN as u64, owner: program_id }
        .invoke_signed(&signers)?;

    // Create the vault: the fundraiser PDA's associated token account.
    log!("Creating vault");
    CreateIdempotent {
        funding_account: maker,
        account: vault,
        wallet: fundraiser,
        mint: mint_to_raise,
        system_program,
        token_program,
    }
    .invoke()?;

    // Persist the fundraiser state.
    let state = Fundraiser {
        maker: *maker.address().as_array(),
        mint_to_raise: *mint_to_raise.address().as_array(),
        amount_to_raise: amount,
        current_amount: 0,
        time_started: Clock::get()?.unix_timestamp,
        duration,
        bump,
    };
    state.serialize(&mut fundraiser.try_borrow_mut()?)?;

    log!("Fundraiser created");
    Ok(())
}
