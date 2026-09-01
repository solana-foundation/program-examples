use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    crypto::{ethereum_address, keccak256, secp256k1_recover},
    error::DelegateError,
    instructions::{check_authority, transfer_from_user_pda},
    state::UserAccount,
};

/// Domain separator, identical to the Anchor version's `TRANSFER_DOMAIN`.
///
/// Prefixing the digest keeps a signature produced for this instruction from
/// meaning anything to another program that happens to hash the same fields.
const TRANSFER_DOMAIN: &[u8] = b"external-delegate-token-master:transfer_tokens:v1";

/// Moves tokens on the strength of an Ethereum signature.
///
/// The digest commits to every value that decides where the funds go — the
/// program, the user account, both token accounts, the amount — plus a nonce,
/// so a signature cannot be replayed for a different transfer or reused after
/// it has been spent. It is signed raw, with no EIP-191 prefix, so a wallet's
/// default `personal_sign` output deliberately will not verify.
///
/// Accounts:
///   0. `[writable]` user account
///   1. `[signer]`   authority
///   2. `[writable]` user token account (owned by the user PDA)
///   3. `[writable]` recipient token account
///   4. `[]`         user PDA (`[user_account]`)
///   5. `[]`         SPL Token program
///
/// Instruction data: `[amount: u64 (LE), signature: [u8; 65]]`, where the
/// signature is `r || s || recovery_id`.
pub fn transfer_tokens(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
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
    let signature: &[u8; 65] = data
        .get(8..73)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    let (expected_address, nonce) = {
        let mut account_data = user_account.try_borrow_mut()?;
        let state = UserAccount::from_bytes(&mut account_data)?;
        (state.ethereum_address(), state.nonce())
    };

    // An account whose address was never set would otherwise accept any
    // signature that recovers to the all-zero address.
    if expected_address == [0u8; 20] {
        return Err(DelegateError::EthereumAddressUnset.into());
    }

    let digest = keccak256(&[
        TRANSFER_DOMAIN,
        program_id.as_ref(),
        user_account.address().as_ref(),
        user_token_account.address().as_ref(),
        recipient_token_account.address().as_ref(),
        &amount.to_le_bytes(),
        &nonce.to_le_bytes(),
    ]);

    let recovery_id = signature[64];
    let compact: &[u8; 64] = signature[..64].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    let recovered = secp256k1_recover(&digest, recovery_id, compact).ok_or(DelegateError::InvalidSignature)?;

    if ethereum_address(&recovered) != expected_address {
        return Err(DelegateError::InvalidSignature.into());
    }

    // Burn the nonce before moving anything, so the same signature cannot be
    // presented twice.
    let next_nonce = nonce.checked_add(1).ok_or(DelegateError::NonceOverflow)?;
    UserAccount::from_bytes(&mut user_account.try_borrow_mut()?)?.set_nonce(next_nonce);

    log!("Signature verified, transferring");
    transfer_from_user_pda(program_id, user_account, user_pda, user_token_account, recipient_token_account, amount)
}
