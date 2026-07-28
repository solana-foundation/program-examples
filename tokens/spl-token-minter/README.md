# SPL Token Minter

Minting SPL Tokens is a conceptually straightforward process.

The only tricky part is understanding how Solana tracks users' balance of SPL Tokens.

---

After all, we know every account on Solana by default tracks that account's balance of SOL (the native token), but how could every account on Solana possibly track it's own balance of _any possible_ SPL Token on the Solana network?

TL/DR it's impossible. Instead, we have to use separate accounts that are specifically configured per SPL Token. These are called **Associated Token Accounts**.

---

For example, if I create the JOE token, and I want to know what someone's balance of JOE is, I would need to do the following:

```text
1. Create the JOE token
2. Create an Associated Token Account for this user's wallet to track his/her balance of JOE
3. Mint or transfer JOE token to their JOE Associated Token Account
```

---

Thus, you can think of Associated Token Accounts as simple counters, which point to a Mint and a Wallet. They simply say "here's the balance of this particular Mint for this particular person's Wallet".
