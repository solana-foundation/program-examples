use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_log::log;
use pinocchio_token::instructions::MintTo;

use crate::instructions::TOKEN_METADATA_PROGRAM_ID;
use crate::state::{MintAuthorityPda, MintConfig};

/// Discriminator of the Metaplex `CreateMasterEditionV3` instruction (variant 17
/// of the Token Metadata program's instruction enum).
const CREATE_MASTER_EDITION_V3: u8 = 17;

/// Mints the single NFT token to the payer's associated token account and then
/// creates its master edition account. Both the `MintTo` and the master edition
/// CPIs require the mint authority to sign; since that authority is the program's
/// mint-authority PDA, they are authorized with the PDA's seeds via
/// `invoke_signed`.
///
/// Accounts:
///   0. `[writable]`         mint account
///   1. `[writable]`         metadata account
///   2. `[writable]`         master edition account (the edition PDA)
///   3. `[]`                 mint authority PDA (also the metadata update authority)
///   4. `[]`                 mint config PDA (records who may mint)
///   5. `[writable]`         payer's associated token account (the destination)
///   6. `[signer, writable]` payer (funds the accounts and owns the NFT)
///   7. `[]`                 system program
///   8. `[]`                 token program
///   9. `[]`                 associated token program
///   10. `[]`                token metadata program
///
/// Instruction data: none.
pub fn mint_to(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    // `associated_token_program` and `token_metadata_program` are unused
    // directly, but must be supplied so they are present for the CPIs below.
    let [mint_account, metadata_account, edition_account, mint_authority, mint_config, associated_token_account, payer, system_program, token_program, _associated_token_program, _token_metadata_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Recover the PDA bump recorded by `init` and confirm the supplied account is
    // the mint-authority PDA. The canonical bump is already known, so derive the
    // address directly with `create_program_address` rather than searching for it
    // with `find_program_address`.
    let bump = MintAuthorityPda::deserialize(&mint_authority.try_borrow()?)?.bump;
    let pda = Address::create_program_address(&[MintAuthorityPda::SEED_PREFIX, &[bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if mint_authority.address() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Confirm the supplied account is the mint-config PDA bound to this mint,
    // then that the caller is the wallet recorded as admin at create_token time.
    let (mint_config_pda, _) =
        Address::find_program_address(&[MintConfig::SEED_PREFIX, mint_account.address().as_array()], program_id);
    if mint_config.address() != &mint_config_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if !mint_config.owned_by(program_id) {
        return Err(ProgramError::IncorrectProgramId);
    }
    if MintConfig::deserialize(&mint_config.try_borrow()?)?.admin != *payer.address() {
        log!("Only the admin recorded at token creation may mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Signer seeds for the mint-authority PDA, reused by both CPIs below.
    let bump_bytes = [bump];
    let seeds = [Seed::from(MintAuthorityPda::SEED_PREFIX), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating associated token account if needed");
    CreateIdempotent {
        funding_account: payer,
        account: associated_token_account,
        wallet: payer,
        mint: mint_account,
        system_program,
        token_program,
    }
    .invoke()?;

    log!("Minting NFT to associated token account");
    MintTo {
        mint: mint_account,
        account: associated_token_account,
        mint_authority,
        amount: 1,
        multisig_signers: &[] as &[&AccountView],
    }
    .invoke_signed(&signers)?;

    // Create the master edition. This is what makes the token a real NFT: the
    // Token Metadata program takes over the mint and freeze authorities, so no
    // further tokens can ever be minted from this mint.
    log!("Creating master edition account");
    let edition_data = build_master_edition_data();
    let edition_accounts = [
        InstructionAccount::writable(edition_account.address()),
        InstructionAccount::writable(mint_account.address()),
        // Update authority and mint authority are the same PDA here.
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable(metadata_account.address()),
        InstructionAccount::readonly(token_program.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let instruction =
        InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &edition_accounts, data: &edition_data };
    invoke_signed(
        &instruction,
        &[
            *edition_account,
            *mint_account,
            *mint_authority,
            *mint_authority,
            *payer,
            *metadata_account,
            *token_program,
            *system_program,
        ],
        &signers,
    )?;

    log!("NFT minted successfully");
    Ok(())
}

/// Serializes the data for a Metaplex `CreateMasterEditionV3` instruction.
///
/// Layout: `[17] max_supply:Option<u64>`. A `max_supply` of `Some(1)` caps the
/// number of printable editions, mirroring the `native` example.
fn build_master_edition_data() -> Vec<u8> {
    let mut data = Vec::new();
    data.push(CREATE_MASTER_EDITION_V3);
    data.push(1); // max_supply: Some
    data.extend_from_slice(&1u64.to_le_bytes()); // max_supply value
    data
}
