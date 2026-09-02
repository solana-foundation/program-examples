#![no_std]

pub mod instructions;
pub mod processor;

use pinocchio::{entrypoint, nostd_panic_handler};

entrypoint!(processor::process_instruction);
nostd_panic_handler!();
