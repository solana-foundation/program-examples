# Alt-bn128 G2 operations (Pinocchio)

A stateless program that wraps the BN254 (alt_bn128) G2 group operations added by [SIMD-0302](https://github.com/solana-foundation/solana-improvement-documents/pull/302), via the `sol_alt_bn128_group_op` syscall. Results come back as transaction return data.

| Discriminator | Instruction | Input                                               |
| ------------- | ----------- | --------------------------------------------------- |
| 0             | G2 add      | two big-endian G2 points (128 bytes each)           |
| 1             | G2 mul      | one big-endian G2 point ‖ 32-byte big-endian scalar |

The syscall runs in LiteSVM today but only works on public clusters once the `enable_alt_bn128_g2_syscalls` feature gate activates.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
