use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{instructions::EXTRA_ACCOUNT_METAS_SEED, util::create_pda_account};

/// A serialized `ExtraAccountMetaList` holding this example's one extra
/// account: the sender's transfer switch.
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
///   [4, 0, 32, 32, 0 * 28]                 seed config, padded to 32 bytes
///   [0]                                    is_signer   = false
///   [0]                                    is_writable = false
/// ```
///
/// The seed config is `spl-tlv-account-resolution`'s packed form of
/// `Seed::AccountData { account_index: 0, data_index: 32, length: 32 }`: a `4`
/// tag followed by those three bytes. It takes 32 bytes at offset 32 of account
/// 0 — the source token account's owner — so Token-2022 derives `[owner]`
/// against this program and passes the switch in, and no caller ever has to
/// name it.
///
/// The owner is deliberately *not* taken from account 3, the transfer
/// authority, even though that is simpler and is what the Anchor version does.
/// The authority may be a delegate (or Token-2022's permanent delegate), and
/// keying the switch on it would let an enabled delegate move tokens out of a
/// wallet the admin had switched off. The policy belongs to whoever owns the
/// tokens.
///
/// The list is fixed for this example, so it is a constant rather than a
/// dependency on the TLV encoder.
#[rustfmt::skip]
const EXTRA_ACCOUNT_METAS_DATA: [u8; 51] = [
    105, 37, 101, 197, 75, 251, 102, 26,
    39, 0, 0, 0,
    1, 0, 0, 0,
    1,
    4, 0, 32, 32,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    0,
];

/// Creates the `ExtraAccountMetaList` PDA for `mint`.
///
/// Token-2022 reads this account before every transfer to learn which accounts
/// beyond the four transfer accounts the hook expects. It must exist, otherwise
/// transfers of the mint fail.
///
/// Accounts:
///   0. `[signer, writable]` payer (funds the account)
///   1. `[writable]`         extra account meta list (PDA `[b"extra-account-metas", mint]`)
///   2. `[]`                 mint
///   3. `[]`                 system program
///
/// Instruction data: none beyond the interface discriminator.
pub fn initialize_extra_account_meta_list(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, extra_account_meta_list, mint, _system_program] = accounts else {
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

    extra_account_meta_list.try_borrow_mut()?.copy_from_slice(&EXTRA_ACCOUNT_METAS_DATA);

    log!("Extra account meta list created");
    Ok(())
}
