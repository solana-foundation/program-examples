use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{ADMIN_CONFIG_SEED, ADMIN_CONFIG_SIZE, SWITCH_ON_OFFSET, SWITCH_SIZE},
    util::create_pda_account,
};

/// Turns a wallet's transfers on or off.
///
/// Only the configured admin may call this. The switch account is created on
/// first use, so a wallet with no switch has simply never been enabled — and
/// the hook treats that as off.
///
/// Accounts:
///   0. `[signer, writable]` admin (pays when the switch is first created)
///   1. `[]`                 wallet whose transfers are being switched
///   2. `[]`                 admin config (PDA `[b"admin-config"]`)
///   3. `[writable]`         wallet switch (PDA `[wallet]`)
///   4. `[]`                 system program
///
/// Instruction data: `[on: u8]` — any non-zero value is on.
pub fn switch(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, wallet, admin_config, wallet_switch, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let on = *data.first().ok_or(ProgramError::InvalidInstructionData)? != 0;

    let (admin_config_address, _) = Address::find_program_address(&[ADMIN_CONFIG_SEED], program_id);
    if admin_config.address() != &admin_config_address
        || !admin_config.owned_by(program_id)
        || admin_config.data_len() != ADMIN_CONFIG_SIZE
    {
        return Err(TransferHookError::InvalidAdminConfig.into());
    }
    if admin_config.try_borrow()?.as_ref() != admin.address().as_ref() {
        return Err(TransferHookError::NotAdmin.into());
    }

    // The switch is keyed by the wallet alone — the same derivation Token-2022
    // performs during a transfer from the `AccountKey` seed in the metas list.
    let (switch_address, switch_bump) = Address::find_program_address(&[wallet.address().as_ref()], program_id);
    if wallet_switch.address() != &switch_address {
        return Err(TransferHookError::InvalidSwitchAccount.into());
    }

    if wallet_switch.is_data_empty() {
        let bump_bytes = [switch_bump];
        let seeds = [Seed::from(wallet.address().as_ref()), Seed::from(&bump_bytes)];

        log!("Creating wallet switch");
        create_pda_account(admin, wallet_switch, SWITCH_SIZE, program_id, &seeds)?;
    } else if !wallet_switch.owned_by(program_id) || wallet_switch.data_len() != SWITCH_SIZE {
        return Err(TransferHookError::InvalidSwitchAccount.into());
    }

    let mut switch_data = wallet_switch.try_borrow_mut()?;
    switch_data[..SWITCH_ON_OFFSET].copy_from_slice(wallet.address().as_ref());
    switch_data[SWITCH_ON_OFFSET] = on as u8;

    log!("Switch set");
    Ok(())
}
