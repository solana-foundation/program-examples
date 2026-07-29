use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::instructions::parse_u64;

/// Transfers tokens to another wallet, creating the recipient's associated token
/// account first if it does not already exist.
///
/// Accounts:
///   0. `[]`                 mint account
///   1. `[writable]`         source associated token account
///   2. `[writable]`         destination associated token account
///   3. `[signer]`           authority (owner of the source token account)
///   4. `[]`                 recipient wallet (owner of the destination account)
///   5. `[signer, writable]` payer (funds the destination account)
///   6. `[]`                 system program
///   7. `[]`                 token program
///   8. `[]`                 associated token program
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn transfer_tokens(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [mint_account, source_token_account, destination_token_account, authority, recipient, payer, system_program, token_program, _associated_token_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let amount = parse_u64(data)?;

    log!("Creating recipient associated token account if needed");
    CreateIdempotent {
        funding_account: payer,
        account: destination_token_account,
        wallet: recipient,
        mint: mint_account,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Transferring tokens");
    Transfer {
        multisig_signers: &[] as &[&AccountView],
        from: source_token_account,
        to: destination_token_account,
        authority,
        amount,
    }
    .invoke()?;

    log!("Tokens transferred successfully");
    Ok(())
}
