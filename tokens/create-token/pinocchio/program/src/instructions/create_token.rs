use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::{instructions::InitializeMint2, state::Mint};

use crate::instructions::util::read_borsh_string;
use crate::instructions::util_metaplex::{build_create_metadata_v3_data, METADATA_DATA_MAX, TOKEN_METADATA_PROGRAM_ID};

/// Borsh-encoded arguments for the create-token instruction.
///
/// Field order matches the `native` example's `CreateTokenArgs` so the two
/// options share an identical wire format.
pub struct CreateTokenArgs<'a> {
    pub name: &'a [u8],
    pub symbol: &'a [u8],
    pub uri: &'a [u8],
    pub decimals: u8,
}

impl<'a> CreateTokenArgs<'a> {
    /// Parses the instruction data: three Borsh strings followed by a `u8`.
    pub fn parse(data: &'a [u8]) -> Result<Self, ProgramError> {
        let mut offset = 0;
        let name = read_borsh_string(data, &mut offset)?;
        let symbol = read_borsh_string(data, &mut offset)?;
        let uri = read_borsh_string(data, &mut offset)?;
        let decimals = *data.get(offset).ok_or(ProgramError::InvalidInstructionData)?;
        Ok(Self { name, symbol, uri, decimals })
    }
}

/// Creates a new SPL Token mint and attaches an on-chain Metaplex metadata
/// account to it (name, symbol, URI).
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[]`                 mint authority (also recorded as metadata update authority)
///   2. `[writable]`         metadata account (the Metaplex metadata PDA)
///   3. `[signer, writable]` payer (funds the new accounts)
///   4. `[]`                 system program
///   5. `[]`                 token program
///   6. `[]`                 token metadata program
///
/// Instruction data: Borsh `[name: string, symbol: string, uri: string, decimals: u8]`.
///
/// The mint authority is passed as a non-signer; the metadata CPI requires it to
/// sign, which is satisfied by passing the payer's address for it (the payer
/// signs the transaction). This mirrors the `native` example.
pub fn create_token(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    // `token_program` and `token_metadata_program` are unused directly, but must
    // be supplied so they are present in the transaction for the CPIs below.
    let [mint_account, mint_authority, metadata_account, payer, system_program, _token_program, _token_metadata_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let args = CreateTokenArgs::parse(data)?;

    // Rent-exempt minimum for the mint, read from the Rent sysvar.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(Mint::LEN)?;

    log!("Creating mint account");
    CreateAccount { from: payer, to: mint_account, lamports, space: Mint::LEN as u64, owner: &pinocchio_token::ID }
        .invoke()?;

    log!("Initializing mint account");
    InitializeMint2 {
        mint: mint_account,
        decimals: args.decimals,
        mint_authority: mint_authority.address(),
        freeze_authority: Some(mint_authority.address()),
    }
    .invoke()?;

    log!("Creating metadata account");
    let mut metadata_buffer = [0u8; METADATA_DATA_MAX];
    let metadata_len = build_create_metadata_v3_data(&mut metadata_buffer, args.name, args.symbol, args.uri)?;
    let metadata_data = &metadata_buffer[..metadata_len];
    let metadata_accounts = [
        InstructionAccount::writable(metadata_account.address()),
        InstructionAccount::readonly(mint_account.address()),
        InstructionAccount::readonly_signer(mint_authority.address()),
        InstructionAccount::writable_signer(payer.address()),
        // Update authority — recorded only, not required to sign for V3.
        InstructionAccount::readonly(mint_authority.address()),
        InstructionAccount::readonly(system_program.address()),
    ];
    let instruction =
        InstructionView { program_id: &TOKEN_METADATA_PROGRAM_ID, accounts: &metadata_accounts, data: metadata_data };
    invoke(
        &instruction,
        &[*metadata_account, *mint_account, *mint_authority, *payer, *mint_authority, *system_program],
    )?;

    log!("Token mint created successfully");
    Ok(())
}
