use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{check_authority, transfer_from_user_pda};

/// Moves tokens on the Solana authority's signature alone.
///
/// The escape hatch: the wallet that created the account can always recover the
/// tokens without involving the Ethereum key, so losing that key does not strand
/// the balance. No nonce is consumed, because there is no off-chain signature to
/// replay.
///
/// Accounts:
///   0. `[]`         user account
///   1. `[signer]`   authority
///   2. `[writable]` user token account (owned by the user PDA)
///   3. `[writable]` recipient token account
///   4. `[]`         user PDA (`[user_account]`)
///   5. `[]`         SPL Token program
///
/// Instruction data: `[amount: u64 (LE)]`
pub fn authority_transfer(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user_account, authority, user_token_account, recipient_token_account, user_pda, _token_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_authority(program_id, user_account, authority)?;

    let amount = u64::from_le_bytes(
        data.get(..8)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    log!("Authority transfer");
    transfer_from_user_pda(program_id, user_account, user_pda, user_token_account, recipient_token_account, amount)
}
