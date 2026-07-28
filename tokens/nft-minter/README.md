# NFT Minter

Minting NFTs is exactly the same as [minting any SPL Token on Solana](../spl-token-minter/), except for immediately after the actual minting has occurred.

What does this mean? Well, when you mint SPL Tokens, you can attach a fixed supply, but in most cases you can continue to mint new tokens at will - increasing the supply of that token.

With an NFT, you're supposed to only have **one**.

So, how do we ensure only one single token can be minted for any NFT?

---

We have to disable minting by changing the Mint Authority on the Mint.

> The Mint Authority is the account that is permitted to mint new tokens into supply.

If we remove this authority - effectively setting it to `null` - we can disable minting of new tokens for this Mint.

> By design, **this is irreversible**.

---

Although we can set this authority to `null` manually, we can also make use of Metaplex again, this time to mark our NFT as Limited Edition.

When we use an Edition - such as a Master Edition - for our NFT, we get some extra metadata associated with our NFT and we also get our Mint Authority deactivated by delegating this authority to the Master Edition account.

This will effectively disable future minting, but make sure you understand the ramifications of having the Master Edition account be the Mint Authority - rather than setting it permanently to `null`.
