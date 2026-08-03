# Encrypted ballot (Pinocchio)

Keeps a running twisted ElGamal tally in an account without ever decrypting individual ballots. Each ballot is a 64-byte ciphertext (32-byte Pedersen commitment ‖ 32-byte decrypt handle); the program folds it into the tally with two ristretto255 additions via the `sol_curve_group_op` syscall. The account stores `[count: u16-le][tally: 64]`.

| Discriminator | Instruction | Input                         |
| ------------- | ----------- | ----------------------------- |
| 0             | Tally add   | one 64-byte ballot ciphertext |

Only the holder of the ElGamal secret key can decrypt the final tally; the chain sees nothing but ciphertexts.

## Test

```sh
pnpm install
pnpm build-and-test              # TypeScript tests (mocha + LiteSVM)
cargo test --manifest-path=./program/Cargo.toml   # Rust tests (litesvm), after build-and-test
```
