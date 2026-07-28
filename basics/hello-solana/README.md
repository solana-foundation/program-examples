# Hello Solana

This is it: our first Solana program.

Naturally, we're going to start with "hello, world", but we'll take a look at some of the key things going on here.

## Transactions

First thing's first, we have to understand what's in a Solana transaction.

> For a closer look at transactions, check out the [Solana Core Docs](https://docs.solana.com/developing/programming-model/transactions) or the [Solana Cookbook](https://solanacookbook.com/core-concepts/transactions.html#facts).

The anatomy of a transaction is as follows, but here's the keys:  
:key: **Transactions** are for **the Solana runtime**. They contain information that Solana uses to allow or deny a transaction (signers, blockhash, etc.) and choose whether to process instructions in parallel.  
:key: **Instructions** are for **Solana programs**. They tell the program what to do.  
:key: Our program receives one instruction at a time (`program_id`, `accounts`, `instruction_data`).

#### Transaction

```shell
signatures: [ s, s ]
message:
    header: 000
    addresses: [ aaa, aaa ]
    recent_blockhash: int
    instructions: [ ix, ix ]
```

#### Instruction

```shell
program_id: xxx
accounts: [ aaa, aaa ]
instruction_data: b[]
```
