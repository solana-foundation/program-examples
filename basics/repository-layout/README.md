# Recommended Program Layout

This is the typical layout for a Solana program as it grows in size and begins to require multiple Rust files. You'll notice a lot of the programs in the [Solana Program Library](https://github.com/solana-labs/solana-program-library) follow this format.

> Note: You can structure your Rust `src` folder however you wish - provided you follow Cargo's repository structure standards. You don't have to follow this pattern, but it's here so you can recognize other programs, too.

You can see that the structure for a `native` repository is very similar to that of the `anchor` repository. The only difference is the inclusion of a `processor.rs` in the `native` setup - one of the many things Anchor abstracts away for you!

The `pinocchio` variant follows the same layout as `native` (with a `processor.rs`), but uses the lightweight [Pinocchio](https://github.com/anza-xyz/pinocchio) SDK in a `#![no_std]` crate and emits logs via `pinocchio-log` instead of `msg!`. The instruction data wire format matches the `native` version, so the same Borsh-encoded layout in the TypeScript tests works for both.
