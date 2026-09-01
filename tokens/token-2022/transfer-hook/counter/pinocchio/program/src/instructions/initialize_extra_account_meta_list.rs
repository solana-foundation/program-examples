use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{COUNTER_SEED, COUNTER_SIZE, EXTRA_ACCOUNT_METAS_SEED},
    util::create_pda_account,
};

/// A serialized `ExtraAccountMetaList` holding this example's one extra
/// account: the counter PDA.
///
/// The account is one TLV entry keyed by the `Execute` discriminator, so
/// Token-2022 can find the account list belonging to the instruction it is
/// about to CPI:
///
/// ```text
///   [105, 37, 101, 197, 75, 251, 102, 26]  Execute discriminator
///   [39, 0, 0, 0]                          value length (u32) = 4 + 1 * 35
///   [1, 0, 0, 0]                           account count (u32) = 1
///   ---- one 35-byte ExtraAccountMeta ----
///   [1]                                    address is a PDA of this program
///   [1, 7, b"counter", 0 * 23]             seed config, padded to 32 bytes
///   [0]                                    is_signer  = false
///   [1]                                    is_writable = true
/// ```
///
/// The seed config is `spl-tlv-account-resolution`'s packed form of
/// `Seed::Literal { bytes: b"counter" }`: a `1` tag for `Literal`, the byte
/// length, then the bytes. Token-2022 reads this during a transfer, derives
/// `[b"counter"]` against this program, and passes the resulting account to
/// `Execute` — which is why the client never has to name it.
///
/// The list is fixed for this example, so it is a constant rather than a
/// dependency on the TLV encoder.
#[rustfmt::skip]
const EXTRA_ACCOUNT_METAS_DATA: [u8; 51] = [
    105, 37, 101, 197, 75, 251, 102, 26,
    39, 0, 0, 0,
    1, 0, 0, 0,
    1,
    1, 7, b'c', b'o', b'u', b'n', b't', b'e', b'r',
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    1,
];

/// Creates the `ExtraAccountMetaList` PDA for `mint`, and the counter it
/// resolves to.
///
/// Token-2022 reads the list before every transfer to learn which accounts
/// beyond the four transfer accounts the hook expects. Both accounts are
/// created here so that a mint is ready to transfer after a single call.
///
/// Accounts:
///   0. `[signer, writable]` payer (funds both accounts)
///   1. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   2. `[]`                 mint
///   3. `[writable]`         counter (PDA `[b"counter"]`)
///   4. `[]`                 Token-2022 program
///   5. `[]`                 associated token program
///   6. `[]`                 system program
///
/// Instruction data: none beyond the interface discriminator.
pub fn initialize_extra_account_meta_list(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    // The trailing programs are unused directly, but mirror the account list of
    // the Anchor version of this example.
    let [payer, extra_account_meta_list, mint, counter, _token_program, _associated_token_program, _system_program] =
        accounts
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

    // The counter is shared by every mint this program hooks: its only seed is
    // the literal `b"counter"`, matching the Anchor version.
    let (counter_address, counter_bump) = Address::find_program_address(&[COUNTER_SEED], program_id);
    if counter.address() != &counter_address {
        return Err(ProgramError::InvalidSeeds);
    }

    // Because that counter is global rather than per-mint, setting up a second
    // mint finds it already there. Creating it again would fail and take the
    // whole instruction — including the new mint's list — down with it, so the
    // existing account is reused instead.
    if counter.is_data_empty() {
        let counter_bump_bytes = [counter_bump];
        let counter_seeds = [Seed::from(COUNTER_SEED), Seed::from(&counter_bump_bytes)];

        log!("Creating counter");
        create_pda_account(payer, counter, COUNTER_SIZE, program_id, &counter_seeds)?;
    } else if !counter.owned_by(program_id) || counter.data_len() != COUNTER_SIZE {
        return Err(TransferHookError::InvalidCounterAccount.into());
    }

    log!("Extra account meta list created");
    Ok(())
}
