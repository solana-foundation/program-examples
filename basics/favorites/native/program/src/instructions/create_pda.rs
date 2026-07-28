use crate::state::Favorites;
use borsh::BorshSerialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

pub fn create_pda(program_id: &Pubkey, accounts: &[AccountInfo], data: Favorites) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let user = next_account_info(account_iter)?; // the user who's signing the transaction
    let favorite_account = next_account_info(account_iter)?; // The target account that will be created in the process
    let system_program = next_account_info(account_iter)?;

    // deriving the favorite pda
    let (favorite_pda, favorite_bump) = Pubkey::find_program_address(&[b"favorite", user.key.as_ref()], program_id);

    // Checking if the favorite account is same as the derived favorite pda
    if favorite_account.key != &favorite_pda {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Checking if the pda is already initialized
    if favorite_account.data.borrow().len() == 0 {
        // Initialize the favorite account if it's not initialized
        let space = borsh::to_vec(&data)?.len();
        let lamports = (Rent::get()?).minimum_balance(space);

        let ix = solana_system_interface::instruction::create_account(
            user.key,
            favorite_account.key,
            lamports,
            space as u64,
            program_id,
        );

        invoke_signed(
            &ix,
            &[user.clone(), favorite_account.clone(), system_program.clone()],
            &[&[b"favorite", user.key.as_ref(), &[favorite_bump]]],
        )?;

        // Serialize and store the data
        data.serialize(&mut &mut favorite_account.data.borrow_mut()[..])?;
        msg!("{:#?}", data);
    } else {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    Ok(())
}
