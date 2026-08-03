# Merkle Tree Token Claimer

Distribute a snapshot of token balances with one funded vault and a single 32-byte Merkle root, instead of thousands of individual transfers. Each holder claims their own allocation by presenting a Merkle proof, and the program blocks double-claims with per-index claim receipt PDAs.

This is the standard pattern behind large airdrops and chain migrations — for example, retiring a Cosmos app chain and honoring its balances on Solana.

## How it works

1. **Snapshot balances** on the source system at a chosen height, and map each source owner to a Solana address.
2. **Build a fixed Merkle tree** where each leaf is exactly 40 bytes: `[solana_pubkey (32 bytes) | amount (u64 little-endian, 8 bytes)]`.
3. **Initialize the airdrop**: the program stores the Merkle root, mints the full claimable supply into a vault ATA owned by the program PDA, and revokes the mint authority so no further tokens can ever be minted.
4. **Users claim independently** by submitting `amount + merkle_proof + index`.
5. **The program writes a claim receipt PDA** for that index, so the same allocation can never be claimed twice.

```text
User submits: amount + merkle_proof + index
    ↓
Program recomputes the leaf hash from signer + amount
    ↓
Program verifies the proof against the on-chain root
    ↓
Program creates the claim_receipt PDA for that index
    ↓
Tokens transfer from vault → user's ATA
```

Because the root never changes once claims begin, one user claiming does not invalidate any other user's proof.

## Instructions

| Instruction               | Purpose                                                       | Who calls        |
| ------------------------- | ------------------------------------------------------------- | ---------------- |
| `initialize_airdrop_data` | Create state, mint the supply into the vault, revoke the mint | Authority (once) |
| `update_tree`             | Replace the Merkle root, only before any claims have happened | Authority only   |
| `claim_airdrop`           | Verify the proof, transfer tokens, and create the receipt PDA | Any claimant     |

## Building and testing

```bash
cd anchor
pnpm install
anchor test
```

`anchor test` builds the program and runs the LiteSVM test suite in `tests/litesvm.test.ts`, which covers initialization, pre-claim root updates, successful claims with receipts, duplicate-claim rejection, stolen-proof rejection, proof replay under alternate receipt indices, and the post-claim root freeze.

The client side is written with [`@solana/kit`](https://github.com/anza-xyz/kit): each Anchor instruction is built directly from the IDL — the 8-byte instruction discriminator followed by Borsh-encoded arguments via kit's codecs — and program accounts are decoded the same way. For a larger project, [Codama](https://github.com/codama-idl/codama) can generate this client code from the IDL.

## Generating a tree from a snapshot

`scripts/generate-merkle-tree.ts` turns a snapshot JSON file into the on-chain root plus a proof per claimant:

```bash
cd anchor
pnpm generate-tree scripts/sample-snapshot.json merkle-output.json
```

The tree uses SHA-256 throughout: leaves are `sha256(leaf_bytes)` and parents are `sha256(left || right)`, with the last node of an odd level paired with a 32-byte zero hash. Padding with a zero hash instead of duplicating the last node matters: a duplicated node produces the symmetric parent `sha256(C || C)`, which lets one proof verify under two indices and open two receipt PDAs for the same leaf. `tests/merkle.ts` contains the reference implementation, which matches the program's verifier byte for byte.

## Adapting it for a real distribution

- **Off-chain tooling is on you**: query source balances at the snapshot height, collect each holder's Solana address before the snapshot, and serve each user their proof and index from the generated output.
- **Deploy your own instance**: replace the program ID in `Anchor.toml` and `lib.rs`, and pass your own mint parameters at initialization.
- **Unclaimed balances**: this example keeps claims open forever. If you need a deadline, decay, or clawback policy, add it deliberately — see the migration guide for the tradeoffs.

## Security notes

- The mint authority is revoked during initialization, so the claimable supply is fixed at launch.
- Claim proofs stay stable because `update_tree` refuses to run after the first claim. To change a live distribution, deploy a new instance instead of mutating one users already trust.
- Double-claims are blocked by `claim_receipt` PDAs derived from `(airdrop_state, index)`, and the claim `index` is fully authenticated: verification consumes one index bit per proof level, rejects any leftover high bits, and the zero-hash padding keeps every parent asymmetric — so each leaf verifies under exactly one index and one receipt PDA.
- Claims are bounded twice: each claim checks the proof against the root, and the running `amount_claimed` can never exceed the initialized total.
