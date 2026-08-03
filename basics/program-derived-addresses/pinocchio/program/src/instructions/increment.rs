use pinocchio::{error::ProgramError, AccountView, ProgramResult};

pub fn increment_page_visits(accounts: &mut [AccountView]) -> ProgramResult {
    let [page_visits_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let mut page_visits_bytes = page_visits_account.try_borrow_mut()?;

    let mut page_visits =
        u32::from_le_bytes(page_visits_bytes[0..4].try_into().map_err(|_| ProgramError::InvalidAccountData)?);

    page_visits += 1;

    page_visits_bytes[0..4].copy_from_slice(&page_visits.to_le_bytes());

    Ok(())
}
