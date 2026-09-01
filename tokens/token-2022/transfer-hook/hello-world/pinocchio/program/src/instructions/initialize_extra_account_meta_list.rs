use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{instructions::EXTRA_ACCOUNT_METAS_SEED, util::create_pda_account};

/// A serialized, empty `ExtraAccountMetaList`.
///
/// The account is one TLV entry keyed by the `Execute` discriminator, so
/// Token-2022 can find the account list belonging to the instruction it is
/// about to CPI:
///
/// ```text
///   [105, 37, 101, 197, 75, 251, 102, 26]  Execute discriminator
///   [4, 0, 0, 0]                           value length (u32) = 4
///   [0, 0, 0, 0]                           account count (u32) = 0
/// ```
///
/// This example resolves no extra accounts, so the list is always these 16
/// bytes — a constant, rather than a dependency on the TLV encoder.
const EXTRA_ACCOUNT_METAS_DATA: [u8; 16] = [105, 37, 101, 197, 75, 251, 102, 26, 4, 0, 0, 0, 0, 0, 0, 0];

/// Creates the `ExtraAccountMetaList` PDA for `mint`.
///
/// Token-2022 reads this account before every transfer to learn which accounts
/// beyond the four transfer accounts the hook expects. It must exist even when
/// the list is empty, otherwise transfers of the mint fail.
///
/// Accounts:
///   0. `[signer, writable]` payer (funds the account)
///   1. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   2. `[]`                 mint
///   3. `[]`                 Token-2022 program
///   4. `[]`                 associated token program
///   5. `[]`                 system program
///
/// Instruction data: none beyond the interface discriminator.
pub fn initialize_extra_account_meta_list(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    // The trailing programs are unused directly, but mirror the account list of
    // the Anchor version of this example.
    let [payer, extra_account_meta_list, mint, _token_program, _associated_token_program, _system_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_address, bump) =
        Address::find_program_address(&[EXTRA_ACCOUNT_METAS_SEED, mint.address().as_ref()], program_id);
    if extra_account_meta_list.address() != &expected_address {
        return Err(ProgramError::InvalidSeeds);
    }

    let bump_bytes = [bump];
    let seeds = [Seed::from(EXTRA_ACCOUNT_METAS_SEED), Seed::from(mint.address().as_ref()), Seed::from(&bump_bytes)];

    log!("Creating extra account meta list");
    create_pda_account(payer, extra_account_meta_list, EXTRA_ACCOUNT_METAS_DATA.len(), program_id, &seeds)?;

    let mut account_data = extra_account_meta_list.try_borrow_mut()?;
    account_data.copy_from_slice(&EXTRA_ACCOUNT_METAS_DATA);

    log!("Extra account meta list created");
    Ok(())
}
