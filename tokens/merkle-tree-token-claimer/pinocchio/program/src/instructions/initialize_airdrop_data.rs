use pinocchio::{
    cpi::Seed,
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_associated_token_account::instructions::Create;
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::{AuthorityType, InitializeMint2, MintTo, SetAuthority};

use crate::{
    error::ClaimError,
    state::{AirdropState, AIRDROP_STATE_SEED, AIRDROP_STATE_SIZE, MINT_DECIMALS},
    util::create_pda_account,
};

/// Size of a legacy SPL Token mint.
const MINT_SIZE: usize = 82;

/// Creates the airdrop: a fresh mint, a vault holding the whole supply, and the
/// state account recording the Merkle root claims are checked against.
///
/// The mint authority is dropped once the supply is minted, so the airdrop is
/// closed-ended — nobody, including the creator, can print more of it.
///
/// Accounts:
///   0. `[writable]`         airdrop state (PDA `[b"merkle_tree", mint]`)
///   1. `[signer, writable]` mint (a fresh keypair)
///   2. `[writable]`         vault (the airdrop state's associated token account)
///   3. `[signer, writable]` authority (pays, and mints the supply)
///   4. `[]`                 system program
///   5. `[]`                 SPL Token program
///   6. `[]`                 associated token program
///
/// Instruction data: `[merkle_root: [u8; 32], amount: u64 (LE)]`
pub fn initialize_airdrop_data(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [airdrop_state, mint, vault, authority, _system_program, token_program, _associated_token_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !authority.is_signer() || !mint.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let merkle_root: [u8; 32] = data
        .get(..32)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let amount = u64::from_le_bytes(
        data.get(32..40)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    if amount == 0 {
        return Err(ClaimError::InvalidAmount.into());
    }

    let (state_address, state_bump) =
        Address::find_program_address(&[AIRDROP_STATE_SEED, mint.address().as_ref()], program_id);
    if airdrop_state.address() != &state_address {
        return Err(ClaimError::InvalidSeeds.into());
    }

    let rent = Rent::get()?;

    log!("Creating mint");
    CreateAccount {
        from: authority,
        to: mint,
        lamports: rent.try_minimum_balance(MINT_SIZE)?,
        space: MINT_SIZE as u64,
        owner: token_program.address(),
    }
    .invoke()?;

    InitializeMint2 { mint, decimals: MINT_DECIMALS, mint_authority: authority.address(), freeze_authority: None }
        .invoke()?;

    log!("Creating airdrop state");
    let state_bump_bytes = [state_bump];
    let state_seeds =
        [Seed::from(AIRDROP_STATE_SEED), Seed::from(mint.address().as_ref()), Seed::from(&state_bump_bytes)];
    create_pda_account(authority, airdrop_state, AIRDROP_STATE_SIZE, program_id, &state_seeds)?;

    AirdropState::from_bytes(&mut airdrop_state.try_borrow_mut()?)?.initialize(
        &merkle_root,
        authority.address(),
        mint.address(),
        amount,
        state_bump,
    );

    log!("Creating vault");
    Create {
        funding_account: authority,
        account: vault,
        wallet: airdrop_state,
        mint,
        system_program: _system_program,
        token_program,
    }
    .invoke()?;

    log!("Minting the airdrop supply");
    MintTo::<&AccountView> { mint, account: vault, mint_authority: authority, amount, multisig_signers: &[] }
        .invoke()?;

    // Drop the mint authority so the supply is fixed at what the vault holds.
    log!("Revoking the mint authority");
    SetAuthority::<&AccountView> {
        account: mint,
        authority,
        authority_type: AuthorityType::MintTokens,
        new_authority: None,
        multisig_signers: &[],
    }
    .invoke()?;

    log!("Airdrop initialized");
    Ok(())
}
