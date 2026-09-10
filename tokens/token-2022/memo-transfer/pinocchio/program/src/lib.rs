#![no_std]

// The `entrypoint!` macro installs the default (bump) global allocator, so the
// `alloc` crate is available — we use it to build the Token-2022 instruction
// data at runtime.
extern crate alloc;

pub mod instructions;
pub mod processor;

use pinocchio::{entrypoint, nostd_panic_handler};

entrypoint!(processor::process_instruction);
nostd_panic_handler!();
