use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        msg,
        program::invoke,
    },
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::instruction as token_instruction,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct TransferTokensArgs {
    pub quantity: u64,
}

pub fn transfer_tokens(accounts: &[AccountInfo], args: TransferTokensArgs) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let mint_account = next_account_info(accounts_iter)?;
    let from_associated_token_account = next_account_info(accounts_iter)?;
    let to_associated_token_account = next_account_info(accounts_iter)?;
    let owner = next_account_info(accounts_iter)?;
    let recipient = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;
    let associated_token_program = next_account_info(accounts_iter)?;

    if to_associated_token_account.lamports() == 0 {
        msg!("Creating associated token account for recipient...");
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                recipient.key,
                mint_account.key,
                token_program.key,
            ),
            &[
                mint_account.clone(),
                to_associated_token_account.clone(),
                recipient.clone(),
                payer.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;
    } else {
        msg!("Associated token account exists.");
    }
    msg!("Recipient Associated Token Address: {}", to_associated_token_account.key);

    msg!("Transferring {} tokens...", args.quantity);
    msg!("Mint: {}", mint_account.key);
    msg!("Owner Token Address: {}", from_associated_token_account.key);
    msg!("Recipient Token Address: {}", to_associated_token_account.key);
    invoke(
        &token_instruction::transfer(
            token_program.key,
            from_associated_token_account.key,
            to_associated_token_account.key,
            owner.key,
            // Empty: `owner` is a single signer, not a multisig — a non-empty
            // list here wrongly required the recipient to also sign.
            &[],
            args.quantity,
        )?,
        &[
            mint_account.clone(),
            from_associated_token_account.clone(),
            to_associated_token_account.clone(),
            owner.clone(),
            recipient.clone(),
            token_program.clone(),
        ],
    )?;

    msg!("Tokens transferred successfully.");

    Ok(())
}
