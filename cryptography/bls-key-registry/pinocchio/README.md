# BLS key registry (Pinocchio)

Maintains a running aggregate BLS12-381 G2 public key in an account. Adding a member folds their key into the aggregate with the G2 addition syscall; removing one subtracts it with the G2 subtraction syscall — no need to re-aggregate the remaining members. The account stores `[count: u16-le][aggregate: 192]`.

| Discriminator | Instruction | Input                                    |
| ------------- | ----------- | ---------------------------------------- |
| 0             | Add         | one big-endian G2 public key (192 bytes) |
| 1             | Remove      | one big-endian G2 public key (192 bytes) |

The BLS12-381 syscall runs in LiteSVM today but only works on public clusters once the `enable_bls12_381_syscall` feature gate activates.

> **Security note:** this example deliberately omits access control to stay focused on the curve syscalls — any caller can add to or remove from a writable registry account, and the lossy aggregate cannot prove a removed key was ever a member. A production registry needs an authority signer check and its own membership bookkeeping.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
