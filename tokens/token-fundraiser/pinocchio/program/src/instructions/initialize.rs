use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::state::Mint;

use crate::{
    constants::MIN_AMOUNT_TO_RAISE,
    error::FundraiserError,
    instructions::{read_u16, read_u64},
    state::Fundraiser,
};

/// Opens a fundraising campaign: creates the fundraiser PDA that records the
/// target and deadline, plus the vault that will hold contributions.
///
/// Accounts:
///   0. `[signer, writable]` maker (funds the fundraiser account and the vault)
///   1. `[]`                 mint to raise
///   2. `[writable]`         fundraiser account (PDA `[b"fundraiser", maker]`, created here)
///   3. `[writable]`         vault (fundraiser PDA's associated token account, created here)
///   4. `[]`                 token program
///   5. `[]`                 associated token program
///   6. `[]`                 system program
///
/// Instruction data: `[amount: u64 (LE), duration: u16 (LE), bump: u8]`
pub fn initialize(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [maker, mint_to_raise, fundraiser, vault, token_program, _associated_token_program, system_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !maker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let amount = read_u64(data, 0)?;
    let duration = read_u16(data, 8)?;
    let bump = *data.get(10).ok_or(ProgramError::InvalidInstructionData)?;

    // The minimum target scales with the mint's decimals, so a campaign is
    // always worth more than dust. `checked_pow` matters here: `decimals` comes
    // from the mint account, and an absurd value would otherwise overflow and
    // abort the program rather than returning a clean error.
    let decimals = Mint::from_account_view(mint_to_raise)?.decimals();
    let minimum = MIN_AMOUNT_TO_RAISE.checked_pow(decimals as u32).ok_or(FundraiserError::InvalidAmount)?;
    if amount < minimum {
        return Err(FundraiserError::InvalidAmount.into());
    }

    // Verify the supplied fundraiser account is the canonical PDA for these seeds.
    let bump_bytes = [bump];
    let fundraiser_pda =
        Address::create_program_address(&[Fundraiser::SEED_PREFIX, maker.address().as_ref(), &bump_bytes], program_id)
            .map_err(|_| ProgramError::InvalidSeeds)?;
    if fundraiser.address() != &fundraiser_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the fundraiser account, signed by the fundraiser PDA itself.
    let lamports = Rent::get()?.try_minimum_balance(Fundraiser::LEN)?;
    let seeds = [Seed::from(Fundraiser::SEED_PREFIX), Seed::from(maker.address().as_ref()), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating fundraiser account");
    CreateAccount { from: maker, to: fundraiser, lamports, space: Fundraiser::LEN as u64, owner: program_id }
        .invoke_signed(&signers)?;

    // Create the vault: an associated token account for the campaign mint owned
    // by the fundraiser PDA, so only this program can move contributions.
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

    // Persist the campaign terms.
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

    log!("Fundraiser initialized");
    Ok(())
}
