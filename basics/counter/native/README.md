# Counter: Solana Native

This example program is written in Solana using only the Solana toolsuite.

## Build and test

```shell
pnpm build-and-test
```

This builds the program with `cargo build-sbf` and runs the tests against an
in-process `solana-bankrun` runtime — no local validator required.

## Deploy

```shell
pnpm build
pnpm run deploy
```
