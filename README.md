# Program Examples

## Onchain program examples for ⚓ Anchor, 🤥 Pinocchio, and 🦀 Native Rust.

[![Anchor](https://github.com/solana-developers/program-examples/actions/workflows/anchor.yml/badge.svg?event=schedule)](https://github.com/solana-developers/program-examples/actions/workflows/anchor.yml) [![Pinocchio](https://github.com/solana-developers/program-examples/actions/workflows/solana-pinocchio.yml/badge.svg?event=schedule)](https://github.com/solana-developers/program-examples/actions/workflows/solana-pinocchio.yml) [![Native](https://github.com/solana-developers/program-examples/actions/workflows/solana-native.yml/badge.svg?event=schedule)](https://github.com/solana-developers/program-examples/actions/workflows/solana-native.yml)

This repo contains Solana onchain programs (referred to as 'Smart Contracts' in other blockchains).

> [!NOTE]
> If you're new to Solana, you don't need to create your own programs to perform basic things like making accounts, creating tokens, sending tokens, or minting NFTs. These common tasks are handled with existing programs, for example the System Program (for making account or transferring SOL) or the token program (for creating tokens and NFTs). See the [Solana Developer site](https://solana.com/developers) to learn more.

> ⚠️ This repository uses **pnpm** as the default package manager.  
> Ensure pnpm is installed before running any examples.

Each folder includes examples for one or more of the following:

- `anchor` - Written using [Anchor](https://www.anchor-lang.com/), the most popular framework for Solana development, which uses Rust.
  Use `anchor build` and `anchor deploy` to build and deploy the program.
  Tests should be executed using `pnpm test` as defined in the `Anchor.toml` scripts section.

- `pinocchio` - Written using [Pinocchio](https://github.com/febo/pinocchio), a zero-copy, zero-allocation library for Solana programs.
  Build and test commands are the same as native examples.
  Run `pnpm test` to execute tests.

- `native` - Written using Solana's native Rust crates and vanilla Rust.
  Build and test commands are defined via pnpm scripts and use `litesvm` for testing.
  Run `pnpm test` to execute tests.

**If a given example is missing, please send us a PR to add it!** Our aim is to have every example available in every option. We'd also love to see more programs involving staking, wrapped tokens, oracles, compression and VRF. Follow the [contributing guidelines](./CONTRIBUTING.md) to keep things consistent.

## The example programs

## Basics

### Hello world

[Hello World on Solana! A minimal program that logs a greeting.](./basics/hello-solana/README.md)

[anchor](./basics/hello-solana/anchor) [pinocchio](./basics/hello-solana/pinocchio) [native](./basics/hello-solana/native)

### Account-data

Store and retrieve data using Solana accounts.

[anchor](./basics/account-data/anchor) [pinocchio](./basics/account-data/pinocchio) [native](./basics/account-data/native)

### Storing global state - Counter

[Store global state in an account, making a counter that increments when called.](./basics/counter/README.md)

[anchor](./basics/counter/anchor) [pinocchio](./basics/counter/pinocchio) [native](./basics/counter/native)

### Saving per-user state - Favorites

Save and update per-user state on the blockchain, ensuring users can only update their own information.

[anchor](./basics/favorites/anchor) [pinocchio](./basics/favorites/pinocchio) [native](./basics/favorites/native)

### Checking Instruction Accounts

[Check that the accounts provided in incoming instructions meet particular criteria.](./basics/checking-accounts/README.md)

[anchor](./basics/checking-accounts/anchor) [pinocchio](./basics/checking-accounts/pinocchio) [native](./basics/checking-accounts/native)

### Closing Accounts

Close an account and get the Lamports back.

[anchor](./basics/close-account/anchor) [pinocchio](./basics/close-account/pinocchio) [native](./basics/close-account/native)

### Creating Accounts

[Make new accounts on the blockchain, calculating the necessary minimum rent from the account's size.](./basics/create-account/README.md)

[anchor](./basics/create-account/anchor) [pinocchio](./basics/create-account/pinocchio) [native](./basics/create-account/native)

### Cross program invocations

[Invoke an instruction handler from one onchain program in another onchain program.](./basics/cross-program-invocation/README.md)

[anchor](./basics/cross-program-invocation/anchor) [native](./basics/cross-program-invocation/native)

### PDA rent-payer

[Use a PDA to pay the rent for the creation of a new account.](./basics/pda-rent-payer/README.md)

[anchor](./basics/pda-rent-payer/anchor) [pinocchio](./basics/pda-rent-payer/pinocchio) [native](./basics/pda-rent-payer/native)

### Processing instructions

[Add parameters to an instruction handler and use them.](./basics/processing-instructions/README.md)

[anchor](./basics/processing-instructions/anchor) [pinocchio](./basics/processing-instructions/pinocchio) [native](./basics/processing-instructions/native)

### Storing date in program derived addresses

Store and retrieve state in Solana.

[anchor](./basics/program-derived-addresses/anchor) [pinocchio](./basics/program-derived-addresses/pinocchio) [native](./basics/program-derived-addresses/native)

### Handling accounts that expand in size

How to store state that changes size in Solana.

[anchor](./basics/realloc/anchor) [pinocchio](./basics/realloc/pinocchio) [native](./basics/realloc/native)

### Laying out larger programs

[Layout larger Solana onchain programs.](./basics/repository-layout/README.md)

[anchor](./basics/repository-layout/anchor) [native](./basics/repository-layout/native)

### Transferring SOL

[Send SOL between two accounts.](./basics/transfer-sol/README.md)

[anchor](./basics/transfer-sol/anchor) [pinocchio](./basics/transfer-sol/pinocchio) [native](./basics/transfer-sol/native)

## Tokens

### Creating tokens

[Create a token on Solana with a token symbol and icon.](./tokens/create-token/README.md)

[anchor](./tokens/create-token/anchor) [pinocchio](./tokens/create-token/pinocchio) [native](./tokens/create-token/native)

### NFT operations

Create an NFT collection, mint NFTs, and verify NFTs as part of a collection using Metaplex Token Metadata. Reminder: you don't need your own program just to mint an NFT, see the note at the top of this README.

[anchor](./tokens/nft-operations/anchor) [pinocchio](./tokens/nft-operations/pinocchio)

### Transferring Tokens

[Create a token mint, mint tokens, and transfer tokens between accounts.](./tokens/transfer-tokens/README.md)

[anchor](./tokens/transfer-tokens/anchor) [pinocchio](./tokens/transfer-tokens/pinocchio) [native](./tokens/transfer-tokens/native)

### Allowing users to swap digital assets - Escrow

Allow two users to swap digital assets with each other, each getting 100% of what the other has offered due to the power of decentralization!

[anchor](./tokens/escrow/anchor) [pinocchio](./tokens/escrow/pinocchio) [native](./tokens/escrow/native)

### Fundraising with SPL Tokens

Create a fundraiser account specifying a target mint and amount, allowing contributors to deposit tokens until the goal is reached.

[anchor](./tokens/token-fundraiser/anchor)

### Distributing tokens with Merkle-proof claims

[Fund a vault once, publish a Merkle root of a balance snapshot, and let each holder claim their allocation with a proof](./tokens/merkle-tree-token-claimer/README.md) — the claim pattern behind large airdrops and chain migrations.

[anchor](./tokens/merkle-tree-token-claimer/anchor) [pinocchio](./tokens/merkle-tree-token-claimer/pinocchio)

### Minting a token from inside a program with a PDA as the mint authority

[Mint a Token from inside your own onchain program using the Token program.](./tokens/pda-mint-authority/README.md) Reminder: you don't need your own program just to mint an NFT, see the note at the top of this README.

[anchor](./tokens/pda-mint-authority/anchor) [native](./tokens/pda-mint-authority/native) [pinocchio](./tokens/pda-mint-authority/pinocchio)

### Creating an Automated Market Maker

[Create liquidity pools to allow trading of new digital assets and allows users that provide liquidity to be rewarded by creating an Automated Market Maker.](./tokens/token-swap/README.md)

[anchor](./tokens/token-swap/anchor)

### External delegate token master

Control token transfers using an external secp256k1 delegate signature.

[anchor](./tokens/external-delegate-token-master/anchor)

## Token Extensions

### Basics - create token mints, mint tokens, and transfer tokens with Token Extensions

Create token mints, mint tokens, and transfer tokens using Token Extensions.

[anchor](./tokens/token-2022/basics/anchor)

### Preventing CPIs with CPI guard

Enable CPI guard to prevents certain token action from occurring within CPI (Cross-Program Invocation).

[anchor](./tokens/token-2022/cpi-guard/anchor)

### Using default account state

Create new token accounts that are frozen by default.

[anchor](./tokens/token-2022/default-account-state/anchor) [native](./tokens/token-2022/default-account-state/native)

### Grouping tokens

Create tokens that belong to larger groups of tokens using the Group Pointer extension.

[anchor](./tokens/token-2022/group/anchor)

### Creating token accounts whose owner cannot be changed

Create tokens whose owning program cannot be changed.

[anchor](./tokens/token-2022/immutable-owner/anchor)

### Interest bearing tokens

Create tokens that show an 'interest' calculation.

[anchor](./tokens/token-2022/interest-bearing/anchor)

### Requiring transactions to include descriptive memos

Create tokens where transfers must have a memo describing the transaction attached.

[anchor](./tokens/token-2022/memo-transfer/anchor)

### Adding on-chain metadata to the token mint

Create tokens that store their onchain metadata inside the token mint, without needing to use or pay for additional programs.

[anchor](./tokens/token-2022/metadata/anchor)

### Storing NFT metadata using the metadata pointer extension

Create an NFT using the Token Extensions metadata pointer, storing onchain metadata (including custom fields) inside the mint account itself.

[anchor](./tokens/token-2022/nft-meta-data-pointer/anchor)

### Allow a designated account to close a mint

Allow a designated account to close a Mint.

[anchor](./tokens/token-2022/mint-close-authority/anchor) [native](./tokens/token-2022/mint-close-authority/native) [pinocchio](./tokens/token-2022/mint-close-authority/pinocchio)

### Using multiple token extensions

Use multiple Token Extensions at once.

[native](./tokens/token-2022/multiple-extensions/native)

### Non-transferrable - create tokens that can't be transferred.

Create tokens that cannot be transferred.

[anchor](./tokens/token-2022/non-transferable/anchor) [native](./tokens/token-2022/non-transferable/native) [pinocchio](./tokens/token-2022/non-transferable/pinocchio)

### Permanent Delegate - Create tokens permanently under the control of a particular account

Create tokens that remain under the control of an account, even when transferred elsewhere.

[anchor](./tokens/token-2022/permanent-delegate/anchor)

### Create tokens with a transfer-fee.

Create tokens with an inbuilt transfer fee.

[anchor](./tokens/token-2022/transfer-fee/anchor) [native](./tokens/token-2022/transfer-fee/native)

### Transfer hook - hello world

A minimal transfer hook program that executes custom logic on every token transfer.

[anchor](./tokens/token-2022/transfer-hook/hello-world/anchor)

### Transfer hook - counter

Count how many times tokens have been transferred using a transfer hook.

[anchor](./tokens/token-2022/transfer-hook/counter/anchor)

### Transfer hook - using account data as seed

Use token account owner data as seeds to derive extra accounts in a transfer hook.

[anchor](./tokens/token-2022/transfer-hook/account-data-as-seed/anchor)

### Transfer hook - allow/block list

Restrict or allow token transfers using an on-chain allow/block list managed by a list authority.

[anchor](./tokens/token-2022/transfer-hook/allow-block-list-token/anchor)

### Transfer hook - block list with Codama clients

A block-list transfer hook as a full project: Pinocchio program, Codama-generated Rust and TypeScript clients, and a CLI.

[pinocchio](./tokens/token-2022/transfer-hook/block-list/pinocchio)

### Transfer hook - transfer cost

Charge an additional cost or fee on every token transfer using a transfer hook.

[anchor](./tokens/token-2022/transfer-hook/transfer-cost/anchor)

### Transfer hook - transfer switch

Enable or disable token transfers with an on-chain switch using a transfer hook.

[anchor](./tokens/token-2022/transfer-hook/transfer-switch/anchor)

## Compression

### Cnft-burn

Burn compressed NFTs.

[anchor](./compression/cnft-burn/anchor)

### Cnft-vault

Store Metaplex compressed NFTs inside a PDA.

[anchor](./compression/cnft-vault/anchor)

### Cutils

Work with Metaplex compressed NFTs.

[anchor](./compression/cutils/anchor)

## Cryptography

One stateless program per curve, wrapping the raw cryptographic syscalls. These run in LiteSVM today but only work on public clusters once their feature gates activate. Applied examples (multisig, key registry, encrypted ballot) live in the [crypto-primitives-examples](https://github.com/solana-foundation/crypto-primitives-examples) reference repo.

### BN254 (alt_bn128) operations

Add and scalar-multiply G2 points (SIMD-0302) and verify aggregate BLS signatures with a single pairing check, via the `sol_alt_bn128_group_op` syscall.

[pinocchio](./cryptography/bn254/pinocchio)

### BLS12-381 curve operations

Add, subtract, and scalar-multiply BLS12-381 G1 and G2 points with the `sol_curve_group_op` syscall.

[pinocchio](./cryptography/bls12-381/pinocchio)

## Oracles

### pyth

Use a data source for offchain data (called an Oracle) to perform activities onchain.

[anchor](./oracles/pyth/anchor)

## Games

### World Cup bracket prediction

A bracket-prediction game: entrants pay a fee to submit a 32-game bracket, an oracle posts results, scores are tallied on-chain, and the unique winner sweeps the pot. A full Pinocchio + Codama project with a TypeScript client and a webapp.

[pinocchio](./games/world-cup/pinocchio)

### Gacha (provably-fair pack pulls)

A provably-fair gacha / loot-box game — the on-chain mechanic behind RWA pack platforms like Collector Crypt and Phygitals. Buyers open pulls revealed with an RFC 9381 ECVRF anchored in the deployed [`cc-vrf`](https://vrf.collectorcrypt.com) registry by CPI; the VRF input binds buyer entropy, reveals are publicly verifiable off-chain, unsettled pulls are refundable, and prizes are minted as Token-2022 NFTs carrying a `rarity` metadata field. A full Pinocchio + Codama project with TypeScript + Rust clients.

[pinocchio](./games/gacha/pinocchio)

---
