use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{ADMIN_CONFIG_SEED, ADMIN_CONFIG_SIZE},
    util::create_pda_account,
};

/// Sets the admin allowed to flip wallets' transfer switches.
///
/// The first call creates the config and installs `new_admin` unchallenged —
/// whoever configures the program first becomes its admin. Every later call
/// must be signed by the current admin, and cannot reinstall them.
///
/// Accounts:
///   0. `[signer, writable]` admin (the current admin; also pays on first call)
///   1. `[]`                 new admin
///   2. `[writable]`         admin config (PDA `[b"admin-config"]`)
///   3. `[]`                 system program
///
/// Instruction data: none beyond the discriminator.
pub fn configure_admin(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [admin, new_admin, admin_config, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_address, bump) = Address::find_program_address(&[ADMIN_CONFIG_SEED], program_id);
    if admin_config.address() != &expected_address {
        return Err(TransferHookError::InvalidAdminConfig.into());
    }

    if admin_config.is_data_empty() {
        let bump_bytes = [bump];
        let seeds = [Seed::from(ADMIN_CONFIG_SEED), Seed::from(&bump_bytes)];

        log!("Creating admin config");
        create_pda_account(admin, admin_config, ADMIN_CONFIG_SIZE, program_id, &seeds)?;
    } else {
        if !admin_config.owned_by(program_id) || admin_config.data_len() != ADMIN_CONFIG_SIZE {
            return Err(TransferHookError::InvalidAdminConfig.into());
        }

        let current = admin_config.try_borrow()?;
        if current.as_ref() != admin.address().as_ref() {
            return Err(TransferHookError::NotAdmin.into());
        }
        // Mirrors the Anchor version, which refuses a no-op handover.
        if admin.address() == new_admin.address() {
            return Err(TransferHookError::AdminUnchanged.into());
        }
    }

    admin_config.try_borrow_mut()?.copy_from_slice(new_admin.address().as_ref());

    log!("Admin configured");
    Ok(())
}
