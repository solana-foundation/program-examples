# Gacha Simple (Pinocchio)

A provably-fair **gacha** (loot-box / pack-pull) program on Solana with a
**self-certifying prize NFT** — the simplified sibling of
[`../pinocchio`](../pinocchio), with the cc-vrf CPI and Light Protocol dependency
removed. Configure a pool of fixed-weight reward tiers, take an entry fee, reveal
each pull with a verifiable random function (VRF), and mint each prize as a
Token-2022 NFT whose metadata carries its `rarity` **and the full reveal
provenance** — everything needed to verify the draw from the mint account alone.

Built with **Pinocchio** (`no_std`) and **Codama**-generated TypeScript + Rust clients.

## Randomness: RFC 9381 ECVRF, verified off-chain, evidenced in the NFT

1. A buyer opens a pull with 32 random bytes of `client_seed`; the VRF input is
   `alpha = SHA-256(pull_address || client_seed)`. Buyer entropy makes every
   outcome unpredictable — even to the operator — before the buy lands. (A merely
   _fixed_ alpha is not enough: `beta = VRF(operator_key, alpha)` is
   deterministic, so a predictable alpha lets the operator precompute outcomes.)
2. The pool's operator computes `beta = VRF(alpha)` off-chain and submits
   `settle_and_distribute`, which expands `beta` into a fixed-weight tier
   selection (odds independent of settle order, by construction), mints the prize
   NFT straight to the buyer with `rarity`, `pull`, `client_seed`, `beta`, and
   `proof` in its Token-2022 metadata, and closes the pull (rent back to the
   buyer).
3. Anyone verifies a prize from live accounts alone — no transaction-history
   lookup. The mint's metadata `update_authority` is the pool PDA, so the NFT
   names its pool; the pool account supplies the operator key and tier weights.
   Recompute `alpha = SHA-256(pull || client_seed)`, check the proof with
   [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf)
   against `pool.operator`, and reproduce the tier with `selectTier` — the
   client ships this as `verifyPrizeProvenance`.
4. If the operator never reveals, the buyer reclaims fee + rent with
   `refund_pull` after the pool's deadline; the admin can only ever withdraw
   settled revenue.

On-chain the program trusts the operator's signature; cheating is _detectable_
off-chain rather than _prevented_ on-chain. One reveal per pull is structural:
pull addresses are seeded by a monotonic pool index, the prize mint is a PDA of
the pull that can only be created once, and the pull closes at settle. See
`CLAUDE.md` for the full trust model and the comparison with the cc-vrf/Light
variant next door.

## Layout

| Path                       | What                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `program/`                 | Pinocchio on-chain program (`gacha-simple-program`)                                   |
| `program/src/gacha.rs`     | Pure `select_tier` + `derive_alpha` + `format_hex` (host unit-tested)                 |
| `tests/integration-tests/` | LiteSVM integration tests — including the full settle + mint happy path               |
| `clients/typescript/`      | Codama TS client + `selectTier`/`pullAlpha`/ECVRF/provenance (`@solana/gacha-simple`) |
| `clients/rust/`            | Codama Rust client (`gacha-simple-client`)                                            |
| `scripts/`                 | Client generation, pool setup, buy, operator crank, off-chain demo                    |
| `idl/`                     | Committed Codama IDL                                                                  |

## Quick start

```bash
just setup     # install deps (needs pnpm, cargo, solana-keygen)
just build     # program .so → IDL → clients
just test      # unit + integration + client tests
just demo      # off-chain operator/verifier walkthrough (no RPC)
```

No prover, no Photon RPC, no program dumps — the entire lifecycle, including the
settle-and-mint happy path, runs in LiteSVM.

## The program

**Accounts**

- **Pool** `["pool", admin]` — one machine per admin: operator, entry fee, settle
  deadline, up to 8 fixed tier weights, pull and pending counters.
- **Pull** `["pull", pool, buyer, index]` — one pending pull: `client_seed`,
  `alpha`, `requested_slot`. The account existing _is_ the pending state; settle
  and refund both close it.
- **Vault** `["vault", admin]` — escrows entry fees; always covers pending refunds.
- **Prize mint** `["mint", pull]` — Token-2022 NFT: decimals 0, supply 1,
  metadata in the mint itself with `rarity` + `pull` + `client_seed` + `beta` +
  `proof` (hex) in `additional_metadata`, and the pool PDA as metadata
  `update_authority` (the link verifiers follow to the operator key and
  weights). Its existence doubles as the once-only settle guard.

**Instructions**

- `init_pool` — admin configures tiers, fee, deadline, operator; creates pool + vault.
- `buy_pull` — buyer pays the entry fee (plus pull rent) and commits a pending
  pull with their `client_seed`.
- `settle_and_distribute` — operator reveals `beta` + proof; the program selects
  the tier, mints the self-certifying prize NFT to the buyer, and closes the pull.
- `refund_pull` — buyer reclaims fee + rent once the settle deadline passes.
- `withdraw_fees` — admin withdraws settled revenue (never pending escrow).

The provenance metadata costs ~0.007 SOL of mint rent per settle, paid by the
operator — the price of an NFT that proves its own draw.

Edit the program, then run `just generate-clients` to regenerate the IDL and clients.

## License

MIT
