use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

fn process_instruction(_program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let payer = next_account_info(accounts_iter)?;
    let new_account = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    msg!("Program invoked. Creating a system account...");
    msg!("  New public key will be: {}", &new_account.key.to_string());

    // Determine the necessary minimum rent by calculating the account's size
    let account_span = instruction_data.len();
    let lamports_required = (Rent::get()?).minimum_balance(account_span);

    msg!("Account span: {}", &account_span);
    msg!("Lamports required: {}", &lamports_required);

    invoke(
        &solana_system_interface::instruction::create_account(
            payer.key,
            new_account.key,
            lamports_required,
            account_span as u64,
            &solana_system_interface::program::ID,
        ),
        &[payer.clone(), new_account.clone(), system_program.clone()],
    )?;

    msg!("Account created succesfully.");
    Ok(())
}
