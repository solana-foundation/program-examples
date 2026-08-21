use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;

use crate::instructions::{
    build_verify_collection_data, NftOperationsError, AUTHORITY_SEED, COLLECTION_AUTHORITY_LEN,
    COLLECTION_AUTHORITY_SEED, TOKEN_METADATA_PROGRAM_ID,
};

/// Verifies an NFT as a member of its collection via the Metaplex `Verify`
/// instruction (`VerificationArgs::CollectionV1`), signed by the collection's
/// update authority — the program's `[b"authority"]` PDA. Only the wallet
/// recorded as the collection's creator (in `collection_authority`, set at
/// `create_collection` time) may do this — the PDA itself would otherwise
/// sign unconditionally for whoever calls this instruction.
///
/// Accounts:
///   0. `[signer, writable]` payer (transaction fee payer)
///   1. `[]`                 mint authority PDA (`[b"authority"]`, the collection update authority)
///   2. `[]`                 collection authority PDA (`[b"collection_authority", collection_mint]`)
///   3. `[writable]`         metadata account of the NFT being verified
///   4. `[]`                 collection mint
///   5. `[writable]`         collection metadata account
///   6. `[]`                 collection master edition account
///   7. `[]`                 system program
///   8. `[]`                 instructions sysvar
///   9. `[]`                 token metadata program
///
/// Instruction data: none.
pub fn verify_collection(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, mint_authority, collection_authority, metadata, collection_mint, collection_metadata, collection_master_edition, system_program, sysvar_instructions, token_metadata_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive the canonical mint-authority PDA and bump on-chain (as the Anchor
    // example does) instead of trusting a client-supplied bump, and confirm the
    // supplied account matches it.
    let (pda, bump) = Address::find_program_address(&[AUTHORITY_SEED], program_id);
    if mint_authority.address() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }

    let (collection_authority_pda, _) =
        Address::find_program_address(&[COLLECTION_AUTHORITY_SEED, collection_mint.address().as_ref()], program_id);
    if collection_authority.address() != &collection_authority_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    // Pinocchio has no automatic owner/length checks the way Anchor's
    // `Account<T>` does — verify both explicitly before trusting the data.
    if collection_authority.owner() != program_id || collection_authority.data_len() != COLLECTION_AUTHORITY_LEN {
        log!("Unauthorized: collection authority account missing or invalid");
        return Err(NftOperationsError::Unauthorized.into());
    }
    if collection_authority.try_borrow()?.as_ref() != payer.address().as_ref() {
        log!("Unauthorized: signer is not the collection's original creator");
        return Err(NftOperationsError::Unauthorized.into());
    }

    // Sign for the mint-authority PDA (the collection's update authority).
    let bump_bytes = [bump];
    let seeds = [Seed::from(AUTHORITY_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    // Metaplex `Verify` account order. `delegate_record` is unused, so its slot
    // is filled with the Token Metadata program id (as the generated CPI does).
    let data = build_verify_collection_data();
    let verify_accounts = [
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::readonly(token_metadata_program.address()),
        InstructionAccount::writable(metadata.address()),
        InstructionAccount::readonly(collection_mint.address()),
        InstructionAccount::writable(collection_metadata.address()),
        InstructionAccount::readonly(collection_master_edition.address()),
        InstructionAccount::readonly(system_program.address()),
        InstructionAccount::readonly(sysvar_instructions.address()),
    ];
    let instruction =
        InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &verify_accounts, data: &data };

    log!("Verifying collection");
    invoke_signed(
        &instruction,
        &[
            *mint_authority,
            *token_metadata_program,
            *metadata,
            *collection_mint,
            *collection_metadata,
            *collection_master_edition,
            *system_program,
            *sysvar_instructions,
        ],
        &signers,
    )?;

    log!("Collection verified successfully");
    Ok(())
}
