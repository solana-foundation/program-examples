use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

pub fn get_pda(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user, favorite_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // deriving the favorite pda
    let bump = data[0];
    let favorite_pda = Address::create_program_address(&[b"favorite", user.address().as_ref(), &[bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;

    // Checking if the favorite account is same as the derived favorite pda
    if favorite_account.address() != &favorite_pda {
        return Err(ProgramError::IncorrectProgramId);
    };

    let favorites = favorite_account.try_borrow()?;

    let number = u64::from_le_bytes(favorites[0..8].try_into().map_err(|_| ProgramError::InvalidAccountData)?);
    let color = core::str::from_utf8(&favorites[8..16]).map_err(|_| ProgramError::InvalidAccountData)?;

    let hobby1 = core::str::from_utf8(&favorites[16..32]).map_err(|_| ProgramError::InvalidAccountData)?;

    let hobby2 = core::str::from_utf8(&favorites[32..48]).map_err(|_| ProgramError::InvalidAccountData)?;

    let hobby3 = core::str::from_utf8(&favorites[48..64]).map_err(|_| ProgramError::InvalidAccountData)?;

    let hobby4 = core::str::from_utf8(&favorites[64..80]).map_err(|_| ProgramError::InvalidAccountData)?;

    log!(
        300,
        "User {}'s favorite number is {}, favorite color is: {}, and their hobbies are {} {} {} {}",
        user.address().as_array(),
        number,
        color,
        hobby1,
        hobby2,
        hobby3,
        hobby4,
    );
    Ok(())
}
