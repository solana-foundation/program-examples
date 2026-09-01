#![no_std]

pub mod error;
pub mod instructions;
pub mod processor;
pub mod state;

use pinocchio::{entrypoint, nostd_panic_handler};

entrypoint!(processor::process_instruction);
nostd_panic_handler!();
