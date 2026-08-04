# Gacha (Pinocchio)

A provably-fair **gacha** (loot-box / pack-pull) program on Solana — the on-chain
mechanic behind RWA pack platforms like Collector Crypt and Phygitals. Configure a
pool of fixed-weight reward tiers, take an entry fee, reveal each pull with a
verifiable random function (VRF) anchored in Collector Crypt's real
[`cc-vrf`](https://vrf.collectorcrypt.com) registry by CPI, and mint each prize as
a Token-2022 NFT whose metadata carries its `rarity`.

Built with **Pinocchio** (`no_std`) and **Codama**-generated TypeScript + Rust clients.

## Randomness: RFC 9381 ECVRF, verified off-chain, anchored on-chain

This example uses the same model
Collector Crypt ships — and CPIs their deployed registry program:

1. A buyer opens a pull with 32 random bytes of `client_seed`; the VRF input is
   `alpha = SHA-256(pull_address || client_seed)`. Buyer entropy makes every
   outcome unpredictable — even to the operator — before the buy lands. (A merely
   _fixed_ alpha is not enough: `beta = VRF(operator_key, alpha)` is
   deterministic, so a predictable alpha lets the operator precompute outcomes.)
2. A registered operator computes `beta = VRF(alpha)` off-chain and settles the
   pull. `settle_pull` CPIs cc-vrf's `commit_proof_with_beta`, anchoring
   `{alpha, proof, beta}` hashes in the registry — the commit address derives
   from the pull, so each pull gets exactly one reveal, and the CPI proves the
   operator's registry record is frozen and matches `pool.operator`. The program
   then expands `beta` into a fixed-weight tier selection (odds independent of
   settle order, by construction).
3. Anyone verifies `beta = VRF(alpha)` off-chain with
   [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf) and
   reproduces the tier with `selectTier` / `pullAlpha` — byte-for-byte mirrors of
   the on-chain logic.
4. If the operator never reveals, the buyer reclaims fee + rent with
   `refund_pull` after the pool's deadline; the admin can only ever withdraw
   settled revenue.

On-chain the program trusts the operator's signature; cheating is _detectable_
off-chain rather than _prevented_ on-chain. Oracle VRFs (Switchboard On-Demand,
MagicBlock VRF, ORAO) make the opposite trade: on-chain proof verification at the
cost of oracle fees, latency, and an oracle-liveness dependency. See `CLAUDE.md`
for the full trust model, including cc-vrf trust caveats.

## Layout

| Path                             | What                                                                        |
| -------------------------------- | --------------------------------------------------------------------------- |
| `program/`                       | Pinocchio on-chain program (`gacha-program`)                                |
| `program/src/gacha.rs`           | Pure `select_tier` + `derive_alpha` (host unit-tested)                      |
| `program/src/ccvrf.rs`           | Hand-built Anchor CPI to cc-vrf (no Anchor dependency)                      |
| `tests/integration-tests/`       | LiteSVM integration tests                                                   |
| `tests/light-integration-tests/` | Real cc-vrf CPI tests with Light validity proofs                            |
| `clients/typescript/`            | Codama TS client + `selectTier`/`pullAlpha`/ECVRF helpers (`@solana/gacha`) |
| `clients/rust/`                  | Codama Rust client (`gacha-client`)                                         |
| `scripts/`                       | Client generation + off-chain operator demo                                 |
| `idl/`                           | Committed Codama IDL                                                        |
| `webapp/`                        | Next.js webapp                                                              |

## Quick start

```bash
just setup     # install deps (needs pnpm, cargo, solana-keygen, npm)
just build     # program .so → IDL → clients
just test      # unit + integration + light + client tests
just demo      # off-chain operator/verifier walkthrough (no RPC)
```

On devnet, `just burst-test 200` opens and settles 200 pulls against a throwaway
1-lamport pool, re-derives every reveal off-chain, and scores the tier distribution
(chi-square), the beta bit balance, and the beta byte uniformity — the statistical
counterpart to the per-instruction tests. `just burst-report` re-scores every pull
that pool has recorded without sending a transaction. Both need a devnet operator
registered with `just register-operator`.

The Light-stack tests dump the mainnet cc-vrf binary once (`just dump-cc-vrf`) and
spawn a local prover automatically. Production operators need a Photon-capable RPC
(e.g. Helius) to fetch validity proofs; nothing in `just test` needs an RPC beyond
the one-time program dump.

## The program

**Accounts**

- **Pool** `["pool", admin]` — one machine per admin: operator (+ its cc-vrf
  authority label), entry fee, settle deadline, up to 8 fixed tier weights, pull
  and pending counters.
- **Pull** `["pull", pool, buyer, index]` — one pull: `client_seed`, `alpha`,
  `beta`, selected tier, status (`Pending → Settled → Claimed`); closed on refund.
- **Vault** `["vault", admin]` — escrows entry fees; always covers pending refunds.
- **Prize mint** `["mint", pull]` — Token-2022 NFT: decimals 0, supply 1, metadata
  in the mint itself with `additional_metadata: [("rarity", …)]`.

**Instructions**

- `init_pool` — admin configures tiers, fee, deadline, operator; creates pool + vault.
- `buy_pull` — buyer pays the entry fee (plus pull rent) and commits a pending
  pull with their `client_seed`.
- `settle_pull` — operator reveals `beta` + proof; the program anchors them in
  cc-vrf via CPI and records the selected tier.
- `refund_pull` — buyer reclaims fee + rent once the settle deadline passes.
- `claim_prize` — anyone cranks the prize NFT mint to the buyer.
- `withdraw_fees` — admin withdraws settled revenue (never pending escrow).

Edit the program, then run `just generate-clients` to regenerate the IDL and clients.

## License

MIT
