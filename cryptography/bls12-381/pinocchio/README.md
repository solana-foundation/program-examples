# BLS12-381 curve operations (Pinocchio)

A stateless program that wraps the BLS12-381 group operations of the `sol_curve_group_op` syscall. Results come back as transaction return data. Points are big-endian: G1 = 96 bytes, G2 = 192 bytes; scalars are 32 bytes big-endian and go first in the instruction data.

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
