# Counter: MPL Stack

This example program is written using Solana native using MPL stack.

## Setup

1. Build the program with `cargo build-sbf`
2. Compile the idl with `shank build`
3. Build the typescript SDK with `yarn solita`

- Temporarily, we have to modify line 58 in ts/generated/accounts/Counter.ts
  to `const accountInfo = await connection.getAccountInfo(address, { commitment: "confirmed" });` in order to allow the tests to pass. In the future versions of Solita, this will be fixed.

4. Run tests with `yarn test`
