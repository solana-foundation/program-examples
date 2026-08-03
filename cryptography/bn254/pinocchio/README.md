# BN254 (alt_bn128) operations (Pinocchio)

BN254 is an elliptic curve — a set of points you can "add" and "multiply" using special math. What makes it useful is its _pairing_: an operation that relates points in a way ordinary addition can't, and that's the engine behind things like zero-knowledge proofs and BLS signatures (many signers collapse into one tiny signature that verifies in a single check). This curve math is far too expensive to run in normal program code without blowing past Solana's compute budget, so the runtime provides it as a native building block — the `sol_alt_bn128_group_op` syscall. This example is a thin, stateless wrapper over that syscall: it hands your points and scalars to the runtime and returns the result as transaction return data, so you can see exactly what goes in and comes out before building anything larger on top.

Learn more: [Solana's BN254 G2 syscall spec (SIMD-0302)](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0302-bn254-g2-syscalls.md) · [the alt_bn128/BN254 pairing encoding these ops follow (Ethereum EIP-197)](https://eips.ethereum.org/EIPS/eip-197)

| Discriminator | Instruction      | Input                                                                          |
| ------------- | ---------------- | ------------------------------------------------------------------------------ |
| 0             | G2 add           | two big-endian G2 points (128 bytes each)                                      |
| 1             | G2 mul           | one big-endian G2 point ‖ 32-byte big-endian scalar                            |
| 2             | Aggregate verify | `aggSig` (G1, 64) ‖ `-H(m)` (G1, 64) ‖ one or more G2 pubkeys (128 bytes each) |

Aggregate verify shows what the pairing buys you: N BLS signatures collapse into one 64-byte G1 point, the pubkeys aggregate on-chain with G2 additions, and a single pairing check `e(aggSig, G2) · e(-H(m), aggPk) == 1` verifies them all at once.

The G2 operations run in LiteSVM today but only work on public clusters once the `enable_alt_bn128_g2_syscalls` feature gate activates.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
