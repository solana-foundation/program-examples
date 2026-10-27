use borsh::BorshDeserialize;
use cross_program_invocatio_native_lever::SetPowerStatus;
use {
    solana_account_info::{next_account_info, AccountInfo},
    solana_cpi::invoke,
    solana_instruction::{AccountMeta, Instruction},
    solana_program_entrypoint::entrypoint,
    solana_program_error::ProgramResult,
    solana_pubkey::Pubkey,
};

entrypoint!(pull_lever);

fn pull_lever(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let power = next_account_info(accounts_iter)?;
    let lever_program = next_account_info(accounts_iter)?;

    let set_power_status_instruction = SetPowerStatus::try_from_slice(instruction_data)?;

    let ix = Instruction::new_with_borsh(
        *lever_program.key,                        // Our lever program's ID
        &set_power_status_instruction,             // Passing instructions through
        vec![AccountMeta::new(*power.key, false)], // Just the required account for the other program
    );

    invoke(&ix, &[power.clone()])
}
