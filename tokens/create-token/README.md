# Create an SPL Token

This example demonstrates how to create an SPL Token on Solana with some metadata such as a token symbol and icon.

---

All tokens - including Non-Fungible Tokens (NFTs) are SPL Tokens on Solana.

They follow the SPL Token standard (similar to ERC-20).

```text
Default SPL Tokens  :   9 decimals
NFTs                :   0 decimals
```

### How Decimals Work

```text
Consider token JOE with 9 decimals:

    1 JOE = quantity * 10 ^ (-1 * decimals) = 1 * 10 ^ (-1 * 9) = 0.000000001
```

### Mint & Metadata

SPL Tokens on Solana are referred to as a Mint.

A Mint is defined by a specific type of account on Solana that describes information about a token:

```TypeScript
{
    isInitialized,
    supply,             // The current supply of this token mint on Solana
    decimals,           // The number of decimals this mint breaks down to
    mintAuthority,      // The account who can authorize minting of new tokens
    freezeAuthority,    // The account who can authorize freezing of tokens
}
```

Any metadata about this Mint - such as a nickname, symbol, or image - is stored in a **separate** account called a Metadata Account:

```TypeScript
{
    title,
    symbol,
    uri,                // The URI to the hosted image
}
```

> Project Metaplex is the standard for SPL Token metadata on Solana  
> You can use [Metaplex's Token Metadata Program](https://docs.metaplex.com/) to create metadata for your token.

### Steps to Create an SPL Token

1. Create an account for the Mint.
2. Initialize that account as a Mint Account.
3. Create a metadata account associated with that Mint Account.
