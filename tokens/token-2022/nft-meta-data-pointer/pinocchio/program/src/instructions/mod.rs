mod chop_tree;
mod init_player;
mod mint_nft;

pub use chop_tree::*;
pub use init_player::*;
pub use mint_nft::*;

use pinocchio::{
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::Transfer;

use crate::error::GameError;

/// Tops an account up to rent exemption for its current size.
///
/// Writing token metadata reallocates the mint, so it can drop below the
/// minimum after a longer value is stored.
pub fn top_up_rent(payer: &AccountView, account: &AccountView) -> ProgramResult {
    let required = Rent::get()?.try_minimum_balance(account.data_len())?;
    let current = account.lamports();
    if required > current {
        Transfer { from: payer, to: account, lamports: required - current }.invoke()?;
    }
    Ok(())
}

/// The SPL Token-2022 program ID
/// (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
pub const TOKEN_2022_PROGRAM_ID: Address =
    pinocchio::Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Confirms `account` is the PDA for `seeds`, returning its bump.
pub fn expect_pda(
    program_id: &Address,
    account: &AccountView,
    seeds: &[&[u8]],
) -> Result<u8, pinocchio::error::ProgramError> {
    let (address, bump) = Address::find_program_address(seeds, program_id);
    if account.address() != &address {
        return Err(GameError::InvalidSeeds.into());
    }
    Ok(bump)
}

/// Splits `[len: u8, bytes]` off the front of instruction data.
///
/// The level seed is caller-chosen, so it is length-prefixed rather than
/// running to the end — that keeps room for fields after it.
pub fn read_prefixed(data: &[u8], offset: usize) -> Result<&[u8], pinocchio::error::ProgramError> {
    let len = *data.get(offset).ok_or(pinocchio::error::ProgramError::InvalidInstructionData)? as usize;
    let start = offset + 1;
    data.get(start..start + len).ok_or(pinocchio::error::ProgramError::InvalidInstructionData)
}

/// Confirms `account` is the Token-2022 program.
///
/// The reference declares this slot as `Program<'info, Token2022>`, which
/// Anchor checks for it.
pub fn expect_token_program(account: &AccountView) -> ProgramResult {
    if account.address() != &TOKEN_2022_PROGRAM_ID {
        return Err(pinocchio::error::ProgramError::IncorrectProgramId);
    }
    Ok(())
}

/// Confirms `token_account` proves `owner` holds a token of `mint`.
///
/// Every NFT this program mints shares one metadata authority, so without this
/// any player could pass someone else's mint and rewrite its metadata. The
/// reference's `mint` account carries a `CHECK` comment describing exactly this
/// constraint; it just never enforces it.
pub fn expect_token_holding(token_account: &AccountView, mint: &AccountView, owner: &Address) -> ProgramResult {
    if !token_account.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(GameError::InvalidAccountData.into());
    }

    // Base token account layout, identical in Token-2022: mint, owner, amount.
    let data = token_account.try_borrow()?;
    let bytes: &[u8] = &data;
    let account_mint = bytes.get(0..32).ok_or(GameError::InvalidAccountData)?;
    let account_owner = bytes.get(32..64).ok_or(GameError::InvalidAccountData)?;
    let amount = bytes.get(64..72).ok_or(GameError::InvalidAccountData)?;

    if account_mint != mint.address().as_ref() || account_owner != owner.as_ref() {
        return Err(GameError::WrongAuthority.into());
    }
    if u64::from_le_bytes(amount.try_into().map_err(|_| GameError::InvalidAccountData)?) == 0 {
        return Err(GameError::WrongAuthority.into());
    }
    Ok(())
}
