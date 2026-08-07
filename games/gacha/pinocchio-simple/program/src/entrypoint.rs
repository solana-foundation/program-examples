use pinocchio::{account::AccountView, entrypoint, Address, ProgramResult};

use crate::instructions::{
    buy_pull, emit_event, init_pool, refund_pull, settle_and_distribute, withdraw_fees, GachaInstruction,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    match GachaInstruction::from_bytes(instruction_data)? {
        GachaInstruction::InitPool(data) => init_pool::process(accounts, &data),
        GachaInstruction::BuyPull(data) => buy_pull::process(accounts, &data),
        GachaInstruction::SettleAndDistribute(data) => settle_and_distribute::process(accounts, &data),
        GachaInstruction::RefundPull => refund_pull::process(accounts),
        GachaInstruction::WithdrawFees(data) => withdraw_fees::process(accounts, &data),
        GachaInstruction::EmitEvent => emit_event::process(program_id, accounts),
    }
}
