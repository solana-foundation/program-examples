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

use crate::instructions::{GROUP_MINT_SEED, MINT_DECIMALS, MINT_SIZE, TOKEN_2022_PROGRAM_ID};

/// Token-2022 instruction discriminators (variants of the program's instruction
/// enum) that this example builds by hand.
const INITIALIZE_MINT_2: u8 = 20;
const GROUP_POINTER_EXTENSION: u8 = 40;
/// Sub-instruction of `GroupPointerExtension` that writes the pointer.
const GROUP_POINTER_INITIALIZE: u8 = 0;

/// Creates a Token-2022 mint carrying the `GroupPointer` extension. The mint is a
/// PDA (`[b"group"]`) that points at itself as both the pointer authority and the
/// group address — mirroring the anchor example, where the actual
/// `TokenGroupInitialize` is left out because the group/member data instructions
/// aren't live on Token-2022 yet.
///
/// Accounts:
///   0. `[writable]`         mint account (the `[b"group"]` PDA, created here)
///   1. `[signer, writable]` payer (funds the mint)
///   2. `[]`                 system program
///   3. `[]`                 Token-2022 program
///
/// Instruction data: none.
pub fn initialize_group(program_id: &Address, accounts: &mut [AccountView]) -> ProgramResult {
    // `system_program` and `token_program` are unused directly, but must be
    // supplied so they are present in the transaction for the CPIs below.
    let [mint_account, payer, _system_program, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Derive the canonical PDA and confirm the supplied account matches it.
    let (mint_pda, bump) = Address::find_program_address(&[GROUP_MINT_SEED], program_id);
    if mint_account.address() != &mint_pda {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the mint account, signed by the mint PDA itself, owned by Token-2022.
    let rent = Rent::get()?;
    let lamports = rent.try_minimum_balance(MINT_SIZE)?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(GROUP_MINT_SEED), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];

    log!("Creating group mint account");
    CreateAccount { from: payer, to: mint_account, lamports, space: MINT_SIZE as u64, owner: &TOKEN_2022_PROGRAM_ID }
        .invoke_signed(&signers)?;

    // The `GroupPointer` extension must be initialized *before* the mint itself.
    // The mint points at itself: it is both the pointer authority and the group.
    log!("Initializing group pointer extension");
    let pointer_data = build_group_pointer_data(&mint_pda);
    let pointer_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &pointer_accounts, data: &pointer_data },
        &[*mint_account],
    )?;

    // `InitializeMint2` takes the authorities in its data and needs no rent
    // sysvar account. The mint is its own mint and freeze authority.
    log!("Initializing mint");
    let mint_data = build_initialize_mint2_data(&mint_pda);
    let mint_accounts = [InstructionAccount::writable(mint_account.address())];
    invoke(
        &InstructionView { program_id: &TOKEN_2022_PROGRAM_ID, accounts: &mint_accounts, data: &mint_data },
        &[*mint_account],
    )?;

    log!("Group mint created");
    Ok(())
}

/// Serializes an `InitializeGroupPointer` instruction (`[40, 0]`).
///
/// Layout: `[40, 0] authority: Pubkey group_address: Pubkey`. Both are
/// `OptionalNonZeroPubkey`s (32 bytes; all-zero means `None`) — here both are the
/// mint itself.
fn build_group_pointer_data(mint: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(66);
    data.push(GROUP_POINTER_EXTENSION);
    data.push(GROUP_POINTER_INITIALIZE);
    data.extend_from_slice(mint.as_ref());
    data.extend_from_slice(mint.as_ref());
    data
}

/// Serializes an `InitializeMint2` instruction (variant 20).
///
/// Layout: `[20] decimals: u8 mint_authority: Pubkey freeze_authority:
/// COption<Pubkey>`. The mint is its own mint and freeze authority.
fn build_initialize_mint2_data(mint: &Address) -> Vec<u8> {
    let mut data = Vec::with_capacity(67);
    data.push(INITIALIZE_MINT_2);
    data.push(MINT_DECIMALS);
    data.extend_from_slice(mint.as_ref());
    data.push(1); // freeze_authority: COption::Some
    data.extend_from_slice(mint.as_ref());
    data
}
