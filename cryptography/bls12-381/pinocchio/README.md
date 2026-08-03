# BLS12-381 curve operations (Pinocchio)

BLS12-381 is a modern elliptic curve designed for _pairings_ — a special operation that powers short aggregate signatures (many signers, one small signature to check) and zero-knowledge proofs, and it's the curve Ethereum and Solana's upcoming consensus both rely on. The underlying point math (adding two points, subtracting, or multiplying a point by a number) is far too expensive to run in ordinary program code without exhausting Solana's compute budget, so the runtime exposes it as a native building block: the `sol_curve_group_op` syscall. This example is a thin, stateless wrapper over that syscall — you pass in points and scalars, it returns the result as transaction return data — so you can see the raw curve operations by themselves before combining them into something like signature verification.

Learn more: [Solana's BLS12-381 syscall spec (SIMD-0388)](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0388-bls12-381-syscalls.md) · [BLS12-381 for the rest of us (a beginner-friendly explainer)](https://hackmd.io/@benjaminion/bls12-381)

Points are big-endian: G1 = 96 bytes, G2 = 192 bytes; scalars are 32 bytes big-endian and go first in the instruction data.

| Discriminator | Instruction | Input          |
| ------------- | ----------- | -------------- |
| 0             | G1 add      | point ‖ point  |
| 1             | G1 sub      | point ‖ point  |
| 2             | G1 mul      | scalar ‖ point |
| 3             | G2 add      | point ‖ point  |
| 4             | G2 sub      | point ‖ point  |
| 5             | G2 mul      | scalar ‖ point |

The syscall runs in LiteSVM today but only works on public clusters once the `enable_bls12_381_syscall` feature gate activates.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
