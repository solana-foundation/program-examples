use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;

use crate::instructions::{build_verify_collection_data, AUTHORITY_SEED, TOKEN_METADATA_PROGRAM_ID};

/// Verifies an NFT as a member of its collection via the Metaplex `Verify`
/// instruction (`VerificationArgs::CollectionV1`), signed by the collection's
/// update authority, the program's `[b"authority"]` PDA.
///
/// Accounts:
///   0. `[signer, writable]` payer (transaction fee payer)
///   1. `[]`                 mint authority PDA (`[b"authority"]`, the collection update authority)
///   2. `[writable]`         metadata account of the NFT being verified
///   3. `[]`                 collection mint
///   4. `[writable]`         collection metadata account
///   5. `[]`                 collection master edition account
///   6. `[]`                 system program
///   7. `[]`                 instructions sysvar
///   8. `[]`                 token metadata program
///
/// Instruction data: none.
pub fn verify_collection(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, mint_authority, metadata, collection_mint, collection_metadata, collection_master_edition, system_program, sysvar_instructions, token_metadata_program] =
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
