pub mod instruction;
pub mod processor;

use {crate::processor::process_instruction, solana_program_entrypoint::entrypoint};

entrypoint!(process_instruction);
