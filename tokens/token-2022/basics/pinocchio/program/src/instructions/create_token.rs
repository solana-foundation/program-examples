use alloc::vec::Vec;

use pinocchio::{
    cpi::{invoke, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

use crate::instructions::{MINT_DECIMALS, MINT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_SEED};

/// `InitializeMint2` instruction discriminator (variant of the Token-2022
/// instruction enum).
const INITIALIZE_MINT_2: u8 = 20;

/// Maximum length (in bytes) of a single PDA seed.
const MAX_SEED_LEN: usize = 32;

/// Creates a Token-2022 mint (6 decimals, no extensions) at the PDA
/// `[b"token-2022-token", signer, token_name]`, with the signer as mint
/// authority and no freeze authority.
///
/// Accounts:
///   0. `[signer, writable]` signer (mint authority + payer)
///   1. `[writable]`         mint account (the derived PDA, created here)
///   2. `[]`                 system program
///   3. `[]`                 Token-2022 program
///
/// Instruction data: `token_name` (raw UTF-8 bytes, used as the final PDA seed).
pub fn create_token(program_id: &Address, accounts: &mut [AccountView], token_name: &[u8]) -> ProgramResult {
    let [signer, mint_account, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // `token_name` is caller-controlled and used directly as a PDA seed. A PDA
    // seed may be at most 32 bytes, so reject oversized names up front with a
    // clear error instead of letting address derivation fail opaquely.
    if token_name.len() > MAX_SEED_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Derive the mint PDA and confirm the supplied account matches it.
    let (mint_pda, bump) =
        Address::find_program_address(&[TOKEN_SEED, signer.address().as_ref(), token_name], program_id);
    if mint_account.address() != &mint_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the mint account, signed by the PDA, owned by Token-2022.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(TOKEN_SEED),
        Seed::from(signer.address().as_ref()),
        Seed::from(token_name),
        Seed::from(&bump_bytes),
    ];
    let signers = [Signer::from(&seeds)];

    log!("Creating mint account");
    CreateAccount { from: signer, to: mint_account, lamports, space: MINT_SIZE as u64, owner: &TOKEN_2022_PROGRAM_ID }
        .invoke_signed(&signers)?;

    log!("Initializing mint");
    let mint_data = build_initialize_mint2_data(signer.address());
    let mint_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint_account],
    )?;

    log!("Mint created");
    Ok(())
}

/// Serializes an `InitializeMint2` instruction (variant 20).
///
/// Layout: `[20] decimals: u8 mint_authority: Pubkey freeze_authority:
/// COption<Pubkey>`. The signer is the mint authority; there is no freeze
/// authority (`COption::None`).
fn build_initialize_mint2_data(mint_authority: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(35);
    data.push(INITIALIZE_MINT_2);
    data.push(MINT_DECIMALS);
    data.extend_from_slice(mint_authority.as_ref());
    data.push(0); // freeze_authority: COption::None
    data
}
