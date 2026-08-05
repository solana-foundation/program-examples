mod error;
mod instructions;
mod state;
mod utils;

use {
    borsh::{BorshDeserialize, BorshSerialize},
    instructions::*,
    solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey},
};

entrypoint!(process_instruction);

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let instruction = EscrowInstruction::try_from_slice(instruction_data)?;

    match instruction {
        EscrowInstruction::MakeOffer(data) => MakeOffer::process(program_id, accounts, data),
        EscrowInstruction::TakeOffer => TakeOffer::process(program_id, accounts),
        EscrowInstruction::RefundOffer => RefundOffer::process(program_id, accounts),
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
// "Offer" is domain vocabulary, not a redundant postfix - keep MakeOffer/TakeOffer/RefundOffer.
#[allow(clippy::enum_variant_names)]
enum EscrowInstruction {
    MakeOffer(MakeOffer),
    TakeOffer,
    RefundOffer,
}
