use crate::state::user::User;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

pub fn close_user(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let target_account = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    // Only the account's owner may close it.
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify target_account is actually payer's User PDA, not another user's account.
    let (expected_user_pda, _) =
        Pubkey::find_program_address(&[User::SEED_PREFIX.as_bytes(), payer.key.as_ref()], program_id);
    if target_account.key != &expected_user_pda {
        return Err(ProgramError::IncorrectProgramId);
    }

    let account_span = 0usize;
    let lamports_required = (Rent::get()?).minimum_balance(account_span);

    let diff = target_account.lamports() - lamports_required;

    // Send the rent back to the payer
    **target_account.lamports.borrow_mut() -= diff;
    **payer.lamports.borrow_mut() += diff;

    // Realloc the account to zero
    target_account.resize(account_span)?;

    // Assign the account to the System Program
    target_account.assign(system_program.key);

    Ok(())
}
