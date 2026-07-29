use pinocchio::{default_panic_handler, no_allocator, program_entrypoint, AccountView, Address, ProgramResult};
use pinocchio_log::log;

// This is the program entrypoint.
program_entrypoint!(process_instruction);
// Do not allocate memory.
no_allocator!();
// Use the default panic handler.
default_panic_handler!();

#[inline(always)]
fn process_instruction(program_id: &Address, _accounts: &mut [AccountView], _instruction_data: &[u8]) -> ProgramResult {
    log!("Hello, Solana!");

    log!("{}", program_id.as_array());

    Ok(())
}
