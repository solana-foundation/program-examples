# Gacha (Pinocchio)

A provably-fair **gacha** (loot-box / pack-pull) program on Solana — the on-chain
mechanic behind RWA pack platforms like Collector Crypt and Phygitals. Configure a
pool of weighted reward tiers with limited supply, take an entry fee, and reveal each
pull with a verifiable random function (VRF).

Built with **Pinocchio** (`no_std`) and **Codama**-generated TypeScript + Rust clients.

## Randomness: RFC 9381 ECVRF, verified off-chain

Solana cannot verify an ECVRF proof on-chain, so this example uses the same model
Collector Crypt ships in [`cc-vrf`](https://vrf.collectorcrypt.com):

1. A buyer opens a pull; the pull account's address is the fixed VRF input `alpha`,
   committed **before** any randomness is known.
2. A registered operator computes `beta = VRF(alpha)` off-chain and settles the pull
   (signing the transaction). The program expands `beta` into a supply-weighted tier
   selection.
3. Anyone verifies `beta = VRF(alpha)` off-chain with
   [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf) and
   reproduces the tier with `selectTier` — a byte-for-byte mirror of the on-chain
   `select_tier`.

On-chain the program trusts the operator's signature; correctness of the randomness
is publicly verifiable off-chain. See `CLAUDE.md` for the full trust model and the
fairness/liveness trade-offs, plus how this compares to MagicBlock VRF and Switchboard.

## Layout

| Path | What |
| --- | --- |
| `program/` | Pinocchio on-chain program (`gacha-program`) |
| `program/src/gacha.rs` | Pure `select_tier` weighted selection (host unit-tested) |
| `tests/integration-tests/` | LiteSVM integration tests |
| `clients/typescript/` | Codama TS client + `selectTier`/ECVRF helpers (`@solana/gacha`) |
| `clients/rust/` | Codama Rust client (`gacha-client`) |
| `scripts/` | Client generation + off-chain operator demo |
| `idl/` | Committed Codama IDL |

## Quick start

```bash
just setup     # install deps (needs pnpm, cargo, solana-keygen)
just build     # program .so → IDL → clients
just test      # unit + integration + client tests
just demo      # off-chain operator/verifier walkthrough (no RPC)
```

## The program

**Accounts**

- **Pool** `["pool", admin]` — one machine per admin: operator, entry fee, up to 8
  reward tiers (weight + supply + remaining), and a pull counter.
- **Pull** `["pull", pool, buyer, index]` — one pull: `alpha`, `beta`, selected tier,
  status.
- **Vault** `["vault", admin]` — escrows entry fees.

**Instructions**

- `init_pool` — admin configures tiers + operator, creates the pool and vault.
- `buy_pull` — buyer pays the entry fee and commits a pending pull.
- `settle_pull` — operator reveals `beta` + proof; the program picks a tier weighted
  by remaining supply and records it.

Edit the program, then run `just generate-clients` to regenerate the IDL and clients.

## License

MIT
