# BLS multisig (Pinocchio)

Verifies aggregate BLS signatures over BN254 with a single pairing check: public keys aggregate on-chain with the alt_bn128 G2 addition syscall, then `e(aggSig, G2) · e(-H(m), aggPk) == 1` is checked with the pairing syscall. Signatures are G1 points (64 bytes), public keys are G2 points (128 bytes), all big-endian.

| Discriminator | Instruction      | Input / accounts                                                             |
| ------------- | ---------------- | ---------------------------------------------------------------------------- |
| 0             | Aggregate verify | `aggSig` (64) ‖ `-H(m)` (64) ‖ pubkeys (128 each); no accounts               |
| 1             | Add signers      | pubkeys (128 each); account 0 = multisig `[count: u16-le][pubkey; capacity]` |
| 2             | Verify           | `aggSig` (64) ‖ `-H(m)` (64); account 0 = multisig                           |

The verify instructions only succeed when every registered signer contributed to the aggregate signature. G2 addition needs the `enable_alt_bn128_g2_syscalls` feature gate on public clusters; LiteSVM has it enabled.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
