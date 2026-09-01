use alloc::vec::Vec;

use pinocchio::{cpi::Seed, error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::{
    error::TransferHookError,
    instructions::{
        ASSOCIATED_TOKEN_PROGRAM_ID, COUNTER_SEED, COUNTER_SIZE, EXTRA_ACCOUNT_METAS_SEED, NATIVE_MINT,
        SPL_TOKEN_PROGRAM_ID,
    },
    util::create_pda_account,
};

/// `Execute`'s TLV discriminator, which keys the `ExtraAccountMetaList` entry.
const EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

/// A serialized `ExtraAccountMeta`: a one-byte kind, a 32-byte address config,
/// then the two flags.
const META_LEN: usize = 35;

/// The seven accounts this hook needs beyond the four transfer accounts and the
/// list itself.
const META_COUNT: u32 = 7;

/// Total size of the account: the 8-byte discriminator, a u32 value length, and
/// the value — a u32 count followed by the metas themselves.
const EXTRA_ACCOUNT_METAS_LEN: usize = 8 + 4 + 4 + META_COUNT as usize * META_LEN;

/// Kinds of `ExtraAccountMeta`, as `spl-tlv-account-resolution` encodes them.
///
/// `0` is a literal address and `1` is a PDA of this program. A PDA of *another*
/// program sets the top bit and carries that program's index in the `Execute`
/// account list in the low bits — so the associated token program at index 7
/// becomes `128 | 7`. (It is the top bit, not `index + 2`: `2` is a separate
/// kind that reads an address out of another account's data.)
const META_LITERAL: u8 = 0;
const META_PDA: u8 = 1;
const META_EXTERNAL_PDA: u8 = 1 << 7;
const META_EXTERNAL_PDA_OF_ACCOUNT_7: u8 = META_EXTERNAL_PDA | 7;

/// Seed configs, in `spl-tlv-account-resolution`'s packed form.
///
/// `Seed::Literal` packs as `[1, length, ...bytes]`, and `Seed::AccountKey` as
/// `[3, index]` — "use the address of the account at this index". Configs are
/// zero-padded to 32 bytes by [`push_meta`].
const SEED_DELEGATE: [u8; 10] = [1, 8, b'd', b'e', b'l', b'e', b'g', b'a', b't', b'e'];
const SEED_COUNTER: [u8; 9] = [1, 7, b'c', b'o', b'u', b'n', b't', b'e', b'r'];

/// The associated-token-account seeds: `[owner, token program, mint]`. The
/// indices are into the `Execute` account list, where 3 is the transfer
/// authority, 5 the wrapped-SOL mint, 6 the SPL Token program and 8 the
/// delegate PDA.
const SEED_DELEGATE_WSOL_ATA: [u8; 6] = [3, 8, 3, 6, 3, 5];
const SEED_SENDER_WSOL_ATA: [u8; 6] = [3, 3, 3, 6, 3, 5];

/// Appends one `ExtraAccountMeta`, zero-padding the address config to 32 bytes.
fn push_meta(out: &mut Vec<u8>, kind: u8, config: &[u8], is_writable: bool) {
    let mut address_config = [0u8; 32];
    address_config[..config.len()].copy_from_slice(config);

    out.push(kind);
    out.extend_from_slice(&address_config);
    out.push(0); // is_signer: nothing the hook resolves ever signs
    out.push(is_writable as u8);
}

/// Builds the `ExtraAccountMetaList` value.
///
/// The order is the contract with Token-2022: it resolves these in sequence and
/// appends them to the `Execute` account list after index 4, so the indices
/// referenced by the seed configs above are fixed by this function.
///
/// ```text
///   5  wrapped SOL mint          literal
///   6  SPL Token program         literal
///   7  associated token program  literal
///   8  delegate                  PDA of this program, [b"delegate"]
///   9  delegate's wSOL account   ATA of 8
///  10  sender's wSOL account     ATA of 3
///  11  counter                   PDA of this program, [b"counter"]
/// ```
fn build_extra_account_metas() -> Vec<u8> {
    let mut data = Vec::with_capacity(EXTRA_ACCOUNT_METAS_LEN);

    data.extend_from_slice(&EXECUTE_DISCRIMINATOR);
    data.extend_from_slice(&(4 + META_COUNT * META_LEN as u32).to_le_bytes());
    data.extend_from_slice(&META_COUNT.to_le_bytes());

    push_meta(&mut data, META_LITERAL, NATIVE_MINT.as_ref(), false);
    push_meta(&mut data, META_LITERAL, SPL_TOKEN_PROGRAM_ID.as_ref(), false);
    push_meta(&mut data, META_LITERAL, ASSOCIATED_TOKEN_PROGRAM_ID.as_ref(), false);
    push_meta(&mut data, META_PDA, &SEED_DELEGATE, true);
    push_meta(&mut data, META_EXTERNAL_PDA_OF_ACCOUNT_7, &SEED_DELEGATE_WSOL_ATA, true);
    push_meta(&mut data, META_EXTERNAL_PDA_OF_ACCOUNT_7, &SEED_SENDER_WSOL_ATA, true);
    push_meta(&mut data, META_PDA, &SEED_COUNTER, true);

    data
}

/// Creates the `ExtraAccountMetaList` PDA for `mint`, and the counter.
///
/// Token-2022 reads the list before every transfer to learn which accounts
/// beyond the four transfer accounts the hook expects, and resolves each one
/// itself — so the fee accounts below never have to be named by a caller.
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

    let metas = build_extra_account_metas();

    log!("Creating extra account meta list");
    create_pda_account(payer, extra_account_meta_list, metas.len(), program_id, &seeds)?;

    let mut account_data = extra_account_meta_list.try_borrow_mut()?;
    account_data.copy_from_slice(&metas);

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
