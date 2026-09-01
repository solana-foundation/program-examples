use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;

/// Creates the signer's associated token account for the given mint. The ATA
/// program derives and owns the account; the `token_program` passed through is
/// Token-2022, so the resulting account is a Token-2022 account.
///
/// Accounts:
///   0. `[signer, writable]` signer (wallet + payer)
///   1. `[]`                 mint account
///   2. `[writable]`         associated token account (created here)
///   3. `[]`                 system program
///   4. `[]`                 Token-2022 program
///   5. `[]`                 associated token program
///
/// Instruction data: none.
pub fn create_associated_token_account(accounts: &mut [AccountView]) -> ProgramResult {
    let [signer, mint_account, token_account, system_program, token_program, _associated_token_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    log!("Creating associated token account");
    Create {
        funding_account: signer,
        account: token_account,
        wallet: signer,
        mint: mint_account,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Associated token account created");
    Ok(())
}
