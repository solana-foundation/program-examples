use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

use crate::event_engine::verify_event_authority;

/// No-op instruction used as the target of self-CPI event emission.
///
/// It only verifies that the caller is the event authority PDA. It exists so
/// indexers can detect event data in the inner instruction. It is never invoked
/// directly by external callers.
pub fn process(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [event_authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !event_authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    verify_event_authority(event_authority)?;

    Ok(())
}
