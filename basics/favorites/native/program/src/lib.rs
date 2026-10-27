use solana_program_entrypoint::entrypoint;

pub mod instructions;
pub mod processor;
pub mod state;

use processor::process_instruction;

entrypoint!(process_instruction);
