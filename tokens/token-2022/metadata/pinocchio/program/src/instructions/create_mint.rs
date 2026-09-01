use alloc::vec::Vec;

use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::{CreateAccount, Transfer};

use crate::instructions::{MINT_DECIMALS, MINT_SIZE_WITH_POINTER, TOKEN_2022_PROGRAM_ID};

/// Token-2022 instruction discriminators (variants of the program's instruction
/// enum) that this example builds by hand.
const INITIALIZE_MINT_2: u8 = 20;
/// Wrapper op for the metadata-pointer instructions; the concrete instruction is
/// selected by a second discriminator byte.
const METADATA_POINTER_EXTENSION: u8 = 39;
const METADATA_POINTER_INITIALIZE: u8 = 0;

/// The 8-byte SPL discriminator for the SPL Token Metadata interface's
/// `Initialize` instruction — the first 8 bytes of
/// `sha256("spl_token_metadata_interface:initialize_account")`. Token-2022
/// implements this interface, so the CPI targets the Token-2022 program.
const TOKEN_METADATA_INITIALIZE: [u8; 8] = [210, 225, 30, 162, 88, 184, 77, 141];

/// The non-string bytes of the `TokenMetadata` TLV entry: the 4-byte TLV header,
/// the update-authority and mint pubkeys (32 each), and the 4-byte length prefix
/// of the (empty) additional-metadata vec. The name/symbol/uri strings — with
/// their own Borsh length prefixes — arrive in the instruction data.
const METADATA_TLV_BASE: usize = 4 + 32 + 32 + 4;

/// Creates a new SPL Token-2022 mint that stores its own on-chain metadata.
///
/// The mint is given the `MetadataPointer` extension pointing at itself, and the
/// variable-length `TokenMetadata` (name/symbol/uri) is written into the same
/// account via the SPL Token Metadata interface, which reallocates the account
/// to fit. Both the mint authority and metadata update authority are the payer.
///
/// Accounts:
///   0. `[signer, writable]` mint account (a fresh keypair to initialize)
///   1. `[signer, writable]` payer (funds the account; mint + update authority)
///   2. `[]`                 system program
///   3. `[]`                 Token-2022 program
///
/// Instruction data: Borsh `[name: String, symbol: String, uri: String]`,
/// forwarded verbatim to the metadata `Initialize` CPI.
pub fn create_mint(accounts: &mut [AccountView], metadata: &[u8]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [mint_account, payer, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let rent = Rent::get()?;

    // 1. Create the mint account, sized for the base mint and the fixed-length
    //    `MetadataPointer` extension only. `TokenMetadataInitialize` reallocates
    //    it larger for the metadata below.
    let base_lamports = rent.try_minimum_balance(MINT_SIZE_WITH_POINTER)?;
    log!("Creating mint account");
    CreateAccount {
        from: payer,
        to: mint_account,
        lamports: base_lamports,
        space: MINT_SIZE_WITH_POINTER as u64,
        owner: &TOKEN_2022_PROGRAM_ID,
    }
    .invoke()?;

    // 2. The `MetadataPointer` extension must be initialized *before* the mint
    //    itself. It points the mint at itself as the metadata account.
    log!("Initializing metadata pointer extension");
    let pointer_data = build_metadata_pointer_data(payer, mint_account);
    let pointer_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &pointer_accounts, data: &pointer_data },
        &[*mint_account],
    )?;

    // 3. Initialize the mint (no rent-sysvar account is required by variant 20).
    log!("Initializing mint");
    let mint_data = build_initialize_mint2_data(payer);
    let mint_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint_account],
    )?;

    // 4. `TokenMetadataInitialize` reallocates the mint to fit the metadata, so
    //    top up its balance to stay rent-exempt at the larger size first.
    let final_size = MINT_SIZE_WITH_POINTER + METADATA_TLV_BASE + metadata.len();
    let topup = rent.try_minimum_balance(final_size)?.saturating_sub(base_lamports);
    if topup > 0 {
        log!("Funding metadata rent");
        Transfer { from: payer, to: mint_account, lamports: topup }.invoke()?;
    }

    // 5. Write the on-chain metadata via the SPL Token Metadata interface, which
    //    Token-2022 implements. The instruction data is the 8-byte discriminator
    //    followed by the Borsh-encoded name/symbol/uri passed to this program.
    log!("Initializing token metadata");
    let mut metadata_data = Vec::with_capacity(TOKEN_METADATA_INITIALIZE.len() + metadata.len());
    metadata_data.extend_from_slice(&TOKEN_METADATA_INITIALIZE);
    metadata_data.extend_from_slice(metadata);
    let metadata_accounts = [
        InstructionAccount::writable(mint_account.address()), // metadata (the mint itself)
        InstructionAccount::readonly(payer.address()),        // update authority
        InstructionAccount::readonly(mint_account.address()), // mint
        InstructionAccount::readonly_signer(payer.address()), // mint authority
    ];
    // pinocchio matches the account views to the instruction's metas positionally,
    // so pass one view per meta (the mint and payer each appear twice).
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &metadata_accounts, data: &metadata_data },
        &[*mint_account, *payer, *mint_account, *payer],
    )?;

    log!("Mint created");
    Ok(())
}

/// Serializes an `InitializeMetadataPointer` instruction (wrapper `39`, sub `0`).
///
/// Layout: `[39][0] authority: OptionalNonZeroPubkey metadata_address:
/// OptionalNonZeroPubkey`. Each optional pubkey is a bare 32-byte key (all-zero
/// means "none"), so there is no tag byte. The metadata address is the mint
/// itself, so its metadata lives in this account.
fn build_metadata_pointer_data(authority: &AccountView, mint: &AccountView) -> Vec<u8> {
    let mut data = Vec::with_capacity(66);
    data.push(METADATA_POINTER_EXTENSION);
    data.push(METADATA_POINTER_INITIALIZE);
    data.extend_from_slice(authority.address().as_ref());
    data.extend_from_slice(mint.address().as_ref());
    data
}

/// Serializes an `InitializeMint2` instruction (variant 20).
///
/// Layout: `[20] decimals: u8 mint_authority: Pubkey freeze_authority:
/// COption<Pubkey>`. Unlike `InitializeMint`, no rent-sysvar account is required.
/// No freeze authority is set (`COption::None`).
fn build_initialize_mint2_data(mint_authority: &AccountView) -> Vec<u8> {
    let mut data = Vec::with_capacity(35);
    data.push(INITIALIZE_MINT_2);
    data.push(MINT_DECIMALS);
    data.extend_from_slice(mint_authority.address().as_ref());
    data.push(0); // freeze_authority: COption::None
    data
}
