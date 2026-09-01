#![no_std]

// The `entrypoint!` macro installs the default (bump) global allocator, so the
// `alloc` crate is available — used to build Token-2022 and token-metadata
// instruction data at runtime.
extern crate alloc;

pub mod decide;
pub mod error;
pub mod instructions;
pub mod metadata;
pub mod processor;
pub mod state;
pub mod token2022;
pub mod util;

use pinocchio::{entrypoint, nostd_panic_handler};

entrypoint!(processor::process_instruction);
nostd_panic_handler!();
