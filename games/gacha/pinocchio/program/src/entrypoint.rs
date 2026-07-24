use pinocchio::{account::AccountView, entrypoint, Address, ProgramResult};

use crate::instructions::{buy_pull, emit_event, init_pool, settle_pull, GachaInstruction};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match GachaInstruction::from_bytes(instruction_data)? {
        GachaInstruction::InitPool(data) => init_pool::process(accounts, &data),
        GachaInstruction::BuyPull => buy_pull::process(accounts),
        GachaInstruction::SettlePull(data) => settle_pull::process(accounts, &data),
        GachaInstruction::EmitEvent => emit_event::process(program_id, accounts),
    }
}
