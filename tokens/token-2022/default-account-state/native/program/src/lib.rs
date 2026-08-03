use solana_system_interface::instruction as system_instruction;
use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint,
        entrypoint::ProgramResult,
        msg,
        program::invoke,
        pubkey::Pubkey,
        rent::Rent,
        sysvar::Sysvar,
    },
    spl_token_2022_interface::{
        extension::{
            default_account_state::instruction::{initialize_default_account_state, update_default_account_state},
            ExtensionType,
        },
        instruction as token_instruction,
        state::AccountState,
        state::Mint,
    },
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CreateTokenArgs {
    pub token_decimals: u8,
}

entrypoint!(process_instruction);

fn process_instruction(_program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let args = CreateTokenArgs::try_from_slice(instruction_data)?;

    let accounts_iter = &mut accounts.iter();

    let mint_account = next_account_info(accounts_iter)?;
    let mint_authority = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let rent = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    // Find the size for the account with the Extension
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::DefaultAccountState])?;

    // Get the required rent exemption amount for the account
    let rent_required = Rent::get()?.minimum_balance(space);

    // Create the account for the Mint and allocate space

    msg!("Mint account address : {}", mint_account.key);
    invoke(
        &system_instruction::create_account(
            payer.key,
            mint_account.key,
            rent_required,
            space as u64,
            token_program.key,
        ),
        &[mint_account.clone(), payer.clone(), system_program.clone(), token_program.clone()],
    )?;

    // This needs to be done before the Mint is initialized

    // Initialize the Default Account State as Frozen
    invoke(
        &initialize_default_account_state(token_program.key, mint_account.key, &AccountState::Frozen).unwrap(),
        &[mint_account.clone(), token_program.clone(), system_program.clone()],
    )?;

    // Initialize the Token Mint
    invoke(
        &token_instruction::initialize_mint(
            token_program.key,
            mint_account.key,
            mint_authority.key,
            Some(mint_authority.key),
            args.token_decimals,
        )?,
        &[mint_account.clone(), mint_authority.clone(), token_program.clone(), rent.clone()],
    )?;

    // Update the Default Account State to Initialized
    invoke(
        &update_default_account_state(
            token_program.key,
            mint_account.key,
            payer.key,
            &[payer.key],
            &AccountState::Initialized,
        )
        .unwrap(),
        &[mint_account.clone(), payer.clone(), token_program.clone(), system_program.clone()],
    )?;

    msg!("Mint created!");

    Ok(())
}
