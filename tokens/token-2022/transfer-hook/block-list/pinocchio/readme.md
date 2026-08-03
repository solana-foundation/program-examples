# Block List

This is a Block List program that implements the Token2022 Transfer-hook execute instruction.
It allows a centralized authority to defined a block list - a collection of wallets that are blocked.
Token issuers (transfer-hook extension authorities), can then setup this program as the hook to be used and choose an operation mode (either filter source wallet, or both source and destination).

## Operation Mode

The Block list has different operation modes depending whether the block list is empty or not and the issuer choice. These modes are achieved by building a different `extra-account-metas` account for the token mint (see `setup_extra_metas` bellow). When the list gets the first blocked wallet, the issuer needs to re-set the `extra-account-metas`.
The modes are the following:

- Empty extra metas - default behaviour when config account counter is 0
- Check Source - default behaviour when config account counter is above 0
- Check both source and destination - optional behaviour when config account counter is above 0

## Accounts

### Config

- Defines the block list authority.
- Tracks the number of blocked wallets.

### WalletBlock

- Defines a wallet as blocked

## Instructions

### init

Initializes the global `Config` account with a given authority to control the block list.

### block_wallet

Adds a given wallet address to the blocked wallets. This creates a `WalletBlock` reccord account.

### unblock_wallet

Removes a given wallet address from the blocked wallets. This removes a `WalletBlock` reccord account.

### setup_extra_metas

Sets up the `extra-account-metas` account dependency for the Transfer-Hook extension. Receives an optional bool value to switch operation modes when the blocked wallet counter is non zero.
Note: once wallets are added to the block list, the issuer needs to call this method again to setup one of the blocking modes.

### tx_hook

The hook that is executed during token transfers.

## Repo contents

### Smart Contract

A pinocchio based Block List smart contract under the [program](program/) folder.

### SDKs

Codama generated rust and ts [SDKs](sdk/). The generated sources are not committed — run `pnpm generate-sdks` after cloning to produce them from [codama.ts](codama.ts).

### CLI

A rust CLI to interact with the contract.

## Building

First install dependencies:

```
pnpm install
```

To build the smart contract:

```
cd program
cargo build-sbf
```

To deploy the smart contract:

```
solana program deploy --program-id <your_program_keypair.json> target/deploy/block_list.so
```

To generate the SDKs:

```
pnpm run generate-sdks
```

To build the CLI:

```
cd cli
cargo build
```

## Testing

```
pnpm build-and-test
```

This regenerates the SDKs, typechecks the TypeScript client, builds the program, and runs the litesvm tests in [program/tests](program/tests/) covering `init`, `block_wallet`, and `unblock_wallet`. The `setup_extra_metas` and `tx_hook` paths require a token-2022 mint with the transfer-hook extension — see the devnet transactions below for end-to-end examples.

## Setup

### Block List

Initialize the block list and defined the authority:

```
target/debug/block-list-cli init
```

Add a wallet to the block list:

```
target/debug/block-list-cli block-wallet <wallet_address>
```

Remove a wallet from the block list:

```
target/debug/block-list-cli unblock-wallet <wallet_address>
```

### Token Mint

Initialize a new token mint:

```
spl-token create-token --program-2022 --transfer-hook BLoCKLSG2qMQ9YxEyrrKKAQzthvW4Lu8Eyv74axF6mf
```

Initialize the extra account metas:

```
target/debug/block-list-cli setup-extra-metas <wallet_address>
```

Change the extra account metas to filter both source and destination token account wallets:

```
target/debug/block-list-cli setup-extra-metas --check-both-wallets <wallet_address>
```

## Devnet deployment

Smart contract was deployed to devnet at address `BLoCKLSG2qMQ9YxEyrrKKAQzthvW4Lu8Eyv74axF6mf`.

Test transfer with empty block list [here](https://explorer.solana.com/tx/2EnQD5mFZvrR3EAyFamCfxJDS3yAtZQxNVhFtK46PanCgbX6rpvgcQ961ZAs8H3auawJZPaVZMpAxoj3qZK55mHT?cluster=devnet&customUrl=http%3A%2F%2Flocalhost%3A8899).

Test transfer with non empty block list only checking source TA [here](https://explorer.solana.com/tx/4pmx31Lx5mXS7FWUtRjAxdRiwKZKCwJv3Du2qGhbLpQUenBuRxRUbrCaGGVjLjeDtpt4AXHzoNex1ppBsmKWSS7r?cluster=devnet&customUrl=http%3A%2F%2Flocalhost%3A8899).

Test transfer with non empty block list checking both source and destination TAs [here](https://explorer.solana.com/tx/Q5Bk6GjGQ9TJtwS5zjDKp7GiFZK6efmGNCcxjqcmzf1YoZZJVE3rQkkSgSBNo7tst4hjUX6SJMsmEGXQ2NAdBjF?cluster=devnet&customUrl=http%3A%2F%2Flocalhost%3A8899).

Simulated transaction that fails due to destination TA owner being blocked [here](https://explorer.solana.com/tx/inspector?cluster=devnet&signatures=%255B%25221111111111111111111111111111111111111111111111111111111111111111%2522%255D&message=AQAHCgqDBmqk%252FDMT5D9rK85EOwBVSTyxwkSJNDGhjodJl5A8fkyFjtMOw8TOzjiallL3mM8ylDy3Dmf4kPO6zjRCB5meTp%252FmYh4SPAIwzTHZRyKqrqiz%252FskDcCP4xKa5KaJaNQKmMSi6syOX%252BagX8jS6oj8o9glIci7jjFsFtVKThVTSAwZGb%252BUhFzL%252F7K26csOb57yM5bvF9xJrLEObOkAAAAC1QoHXoRYodtouw5cKbwI1AuPk%252BVWEpzwvoAzgkyTWD7vvmloKSuwS0IrUHLk7n0Yfp3DOKmgbjiyFpaYfufnS5xfqCyGJ%252BEpC8iKMH9T%252FdgnUADYw6SCHmevlcTztM6TwOn%252FMbMOP4VGXJKhkykzArfWQd9JuJlU%252B0GDnERJVAQbd9uHudY%252FeGEJdvORszdq2GvxNg7kNJ%252F69%252BSjYoYv8sm6yFK1CM9Gp2RvGj6wbHdQmQ4vCDR59WzHPZ5aOHbIDBAAJA9i4BQAAAAAABAAFAkANAwAJCQEIAgAABQcDBgoMAMqaOwAAAAAJ) (press simulate to see logs).

Simulated transaction that fails due to source TA owner being blocked [here](https://explorer.solana.com/tx/inspector?cluster=devnet&signatures=%255B%25221111111111111111111111111111111111111111111111111111111111111111%2522%255D&message=AQAHCrod5ZzEG06%252BJzr8OnDqiGNK2oQt0Rghykcx3Sw51mE4cZQ%252BDFc%252BtWThZi0XGFuhfdEKDoUp3bkLE8gIYc3DR2N%252BTIWO0w7DxM7OOJqWUveYzzKUPLcOZ%252FiQ87rONEIHmQKmMSi6syOX%252BagX8jS6oj8o9glIci7jjFsFtVKThVTSAwZGb%252BUhFzL%252F7K26csOb57yM5bvF9xJrLEObOkAAAAC1QoHXoRYodtouw5cKbwI1AuPk%252BVWEpzwvoAzgkyTWD7vvmloKSuwS0IrUHLk7n0Yfp3DOKmgbjiyFpaYfufnS8Dp%252FzGzDj%252BFRlySoZMpMwK31kHfSbiZVPtBg5xESVQH3LKeXpXVZHuJ4gl0YZu2j5%252FXT6SUfgp2Znq1tIs7tSwbd9uHudY%252FeGEJdvORszdq2GvxNg7kNJ%252F69%252BSjYoYv8tp02GkX6M1fpsk76QI9ZgGPx%252BxaMNWlOk82JXeuOngcDBAAJA9i4BQAAAAAABAAFAkANAwAJCQEHAgAACAUDBgoMAMqaOwAAAAAJ) (press simulate to see logs).

## DISCLAIMER

THIS CODE IS NOT AUDITED NOR REVIEWED. USE AT YOUR OWN DISCRETION.
