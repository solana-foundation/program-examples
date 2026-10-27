use solana_program_entrypoint::entrypoint;

use processor::process_instruction;

pub mod instructions;
pub mod processor;
pub mod state;

entrypoint!(process_instruction);
