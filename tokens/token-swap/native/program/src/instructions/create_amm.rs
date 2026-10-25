use {
    crate::{error::*, state::*},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        program::invoke_signed,
        program_error::ProgramError,
        pubkey::Pubkey,
        rent::Rent,
        sysvar::Sysvar,
    },
    solana_system_interface::instruction as system_instruction,
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct CreateAmmArgs {
    pub id: Pubkey,
    pub fee: u16,
}

pub fn process_create_amm(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    args: CreateAmmArgs,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let amm_account = next_account_info(accounts_iter)?;
    let admin_account = next_account_info(accounts_iter)?;
    let payer_account = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;

    if !payer_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if args.fee >= 10000 {
        return Err(SwapError::InvalidFee.into());
    }

    let (expected_amm_pda, bump) = Pubkey::find_program_address(&[args.id.as_ref()], program_id);
    if expected_amm_pda != *amm_account.key {
        return Err(SwapError::AccountMismatch.into());
    }

    // Create the AMM account
    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(Amm::LEN);

    let create_account_ix = system_instruction::create_account(
        payer_account.key,
        amm_account.key,
        required_lamports,
        Amm::LEN as u64,
        program_id,
    );

    invoke_signed(
        &create_account_ix,
        &[payer_account.clone(), amm_account.clone()],
        &[&[args.id.as_ref(), &[bump]]],
    )?;

    let amm = Amm {
        id: args.id,
        admin: *admin_account.key,
        fee: args.fee,
    };

    amm.serialize(&mut &mut amm_account.data.borrow_mut()[..])?;

    Ok(())
}
