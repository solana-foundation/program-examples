use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{instructions::check_authority, state::UserAccount};

/// Installs the Ethereum address allowed to authorise transfers.
///
/// Only the Solana authority can change it, so control of the account never
/// leaves the wallet that created it.
///
/// Accounts:
///   0. `[writable]` user account
///   1. `[signer]`   authority
///
/// Instruction data: `[ethereum_address: [u8; 20]]`
pub fn set_ethereum_address(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [user_account, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_authority(program_id, user_account, authority)?;

    let ethereum_address: [u8; 20] = data
        .get(..20)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    UserAccount::from_bytes(&mut user_account.try_borrow_mut()?)?.set_ethereum_address(&ethereum_address);

    log!("Ethereum address set");
    Ok(())
}
