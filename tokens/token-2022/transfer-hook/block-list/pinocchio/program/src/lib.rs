#![no_std]

use pinocchio::address::declare_id;
use pinocchio::{
    error::ProgramError, no_allocator, nostd_panic_handler, program_entrypoint, AccountView, Address, ProgramResult,
};

program_entrypoint!(process_instruction);
// Do not allocate memory.
no_allocator!();
// Use the no_std panic handler.
nostd_panic_handler!();

pub mod instructions;
pub use instructions::*;
pub mod error;
pub use error::*;
pub mod state;
pub use state::*;
mod token2022_utils;

declare_id!("BLoCKLSG2qMQ9YxEyrrKKAQzthvW4Lu8Eyv74axF6mf");

#[inline(always)]
fn process_instruction(_program_id: &Address, accounts: &mut [AccountView], instruction_data: &[u8]) -> ProgramResult {
    let [disc, remaining_data @ ..] = instruction_data else {
        return Err(BlockListError::InvalidInstruction.into());
    };

    match *disc {
        TxHook::DISCRIMINATOR => TxHook::try_from(&*accounts)?.process(),
        Init::DISCRIMINATOR => Init::try_from(&*accounts)?.process(),
        BlockWallet::DISCRIMINATOR => BlockWallet::try_from(&*accounts)?.process(),
        UnblockWallet::DISCRIMINATOR => UnblockWallet::try_from(&*accounts)?.process(),
        SetupExtraMetas::DISCRIMINATOR => SetupExtraMetas::try_from(&*accounts)?.process(remaining_data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
