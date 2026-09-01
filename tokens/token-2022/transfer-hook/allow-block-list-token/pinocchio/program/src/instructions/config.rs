use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::AblError,
    instructions::expect_pda,
    state::{
        read_config_authority, write_config, write_wallet, AB_WALLET_SEED, AB_WALLET_SIZE, CONFIG_SEED, CONFIG_SIZE,
    },
    util::create_pda_account,
};

/// Creates the program config, recording who may edit the allow/block list.
///
/// Whoever calls this first becomes the authority, matching the Anchor version.
///
/// Accounts:
///   0. `[signer, writable]` payer (becomes the authority)
///   1. `[writable]`         config (PDA `[b"config"]`)
///   2. `[]`                 system program
///
/// Instruction data: none beyond the discriminator.
pub fn init_config(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, config, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let bump = expect_pda(program_id, config, &[CONFIG_SEED])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&bump_bytes)];

    log!("Creating config");
    create_pda_account(payer, config, CONFIG_SIZE, program_id, &seeds)?;
    write_config(&mut config.try_borrow_mut()?, payer.address(), bump)?;

    log!("Config created");
    Ok(())
}

/// Fails unless `config` is this program's config and names `authority`.
///
/// This is Anchor's `seeds` + `has_one = authority` on the config account.
fn check_authority(program_id: &Address, config: &AccountView, authority: &AccountView) -> ProgramResult {
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    expect_pda(program_id, config, &[CONFIG_SEED])?;
    if !config.owned_by(program_id) {
        return Err(AblError::InvalidAccountData.into());
    }
    if read_config_authority(&config.try_borrow()?)? != authority.address().as_ref() {
        return Err(AblError::NotAuthority.into());
    }
    Ok(())
}

/// Adds a wallet to the allow or block list.
///
/// Accounts:
///   0. `[signer, writable]` authority
///   1. `[]`                 config (PDA `[b"config"]`)
///   2. `[]`                 wallet being listed
///   3. `[writable]`         ab_wallet (PDA `[b"ab_wallet", wallet]`)
///   4. `[]`                 system program
///
/// Instruction data: `[allowed: u8]` — non-zero allows, zero blocks.
pub fn init_wallet(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [authority, config, wallet, ab_wallet, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_authority(program_id, config, authority)?;

    let allowed = *data.first().ok_or(ProgramError::InvalidInstructionData)? != 0;

    let bump = expect_pda(program_id, ab_wallet, &[AB_WALLET_SEED, wallet.address().as_ref()])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(AB_WALLET_SEED), Seed::from(wallet.address().as_ref()), Seed::from(&bump_bytes)];

    log!("Listing wallet");
    create_pda_account(authority, ab_wallet, AB_WALLET_SIZE, program_id, &seeds)?;
    write_wallet(&mut ab_wallet.try_borrow_mut()?, wallet.address(), allowed)?;

    log!("Wallet listed");
    Ok(())
}

/// Removes a wallet's record, returning its rent to the authority.
///
/// A wallet with no record is neither allowed nor blocked, so this restores it
/// to whatever the mint's mode says about unlisted wallets.
///
/// Accounts:
///   0. `[signer, writable]` authority (receives the rent)
///   1. `[]`                 config (PDA `[b"config"]`)
///   2. `[]`                 wallet being delisted
///   3. `[writable]`         ab_wallet (PDA `[b"ab_wallet", wallet]`)
///   4. `[]`                 system program
///
/// Instruction data: none beyond the discriminator.
pub fn remove_wallet(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [authority, config, wallet, ab_wallet, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    check_authority(program_id, config, authority)?;
    expect_pda(program_id, ab_wallet, &[AB_WALLET_SEED, wallet.address().as_ref()])?;

    if !ab_wallet.owned_by(program_id) || ab_wallet.data_len() != AB_WALLET_SIZE {
        return Err(AblError::InvalidAccountData.into());
    }

    log!("Delisting wallet");

    // The rent goes back to the authority, matching Anchor's `close = authority`.
    // It has to move *before* `close`, which zeroes the lamports field outright
    // — closing first would destroy them and unbalance the instruction.
    let reclaimed = ab_wallet.lamports();
    ab_wallet.set_lamports(0);
    authority.set_lamports(authority.lamports().checked_add(reclaimed).ok_or(AblError::InvalidAccountData)?);
    ab_wallet.close()?;

    log!("Wallet delisted");
    Ok(())
}
