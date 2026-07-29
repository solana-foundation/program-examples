use crate::state::Favorites;

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

pub fn create_pda(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user, favorite_account, _] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // deriving the favorite pda
    let bump = data[0];
    let favorite_pda = Address::create_program_address(&[b"favorite", user.address().as_ref(), &[bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;

    // Checking if the favorite account is same as the derived favorite pda
    if favorite_account.address() != &favorite_pda {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Checking if the pda is already initialized
    if favorite_account.try_borrow()?.is_empty() {
        let rent = Rent::get()?;

        // Initialize the favorite account if it's not initialized
        let space = size_of::<Favorites>();
        let lamports = rent.try_minimum_balance(space)?;

        let bump_bytes = bump.to_le_bytes();

        let seeds = [Seed::from(b"favorite"), Seed::from(user.address().as_ref()), Seed::from(&bump_bytes)];

        let signers = [Signer::from(&seeds)];

        CreateAccount { from: user, to: favorite_account, lamports, space: space as u64, owner: program_id }
            .invoke_signed(&signers)?;

        // Serialize and store the data
        let mut favrite_account_data = favorite_account.try_borrow_mut()?;
        favrite_account_data.copy_from_slice(&data[1..]);
    } else {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    Ok(())
}
