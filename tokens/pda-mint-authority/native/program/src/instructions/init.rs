use borsh::BorshSerialize;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::instruction as system_instruction;

use crate::state::MintAuthorityPda;

pub fn init(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let mint_authority = next_account_info(accounts_iter)?;
    let payer = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    let (mint_authority_pda, bump) =
        Pubkey::find_program_address(&[MintAuthorityPda::SEED_PREFIX.as_bytes()], program_id);
    assert!(&mint_authority_pda.eq(mint_authority.key));

    msg!("Creating mint authority PDA...");
    msg!("Mint Authority: {}", &mint_authority.key);
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            mint_authority.key,
            (Rent::get()?).minimum_balance(MintAuthorityPda::SIZE),
            MintAuthorityPda::SIZE as u64,
            program_id,
        ),
        &[mint_authority.clone(), payer.clone(), system_program.clone()],
        &[&[MintAuthorityPda::SEED_PREFIX.as_bytes(), &[bump]]],
    )?;

    let data = MintAuthorityPda { bump };
    data.serialize(&mut &mut mint_authority.data.borrow_mut()[..])?;

    Ok(())
}
