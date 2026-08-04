# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A provably-fair **gacha** (loot-box / pack-pull) game on Solana, modeled on how
platforms like Collector Crypt and Phygitals actually work — and wired into
Collector Crypt's real [`cc-vrf`](https://vrf.collectorcrypt.com) registry
program by CPI. An admin configures a pool of fixed-weight reward tiers and a
fixed entry fee, and registers an off-chain VRF operator. A buyer pays the fee
to open a pull, committing buyer-supplied entropy into the VRF input. The
operator reveals the ECVRF output (`beta`); the program anchors the proof in the
cc-vrf registry, expands `beta` into a weighted tier, and the prize — a
Token-2022 NFT whose metadata carries a `rarity` field — is minted to the buyer.

## Randomness model (important)

RFC 9381 `ECVRF-EDWARDS25519-SHA512-TAI`, following Collector Crypt's cc-vrf.
**Solana cannot verify an ECVRF proof on-chain** (no precompile), so the trust
model is _detection, not prevention_: on-chain the program accepts the
registered operator's signed `beta`; off-chain anyone can prove cheating. The
design closes every gap that detection alone leaves open:

1. **Fixed ≠ unpredictable.** `alpha = SHA-256(pull_address || client_seed)`
   where `client_seed` is 32 random bytes chosen by the buyer at commit. An
   alpha that is merely _fixed_ (say, the pull address alone) is worthless
   against the operator: `beta = VRF(operator_key, alpha)` is deterministic, so
   a predictable alpha lets the operator precompute every outcome before anyone
   buys. Buyer entropy is what makes the outcome unknowable at commit time.
2. **Fixed weights ⇒ order-independence.** Tier odds never change after init,
   so a pull's outcome depends only on its `beta` — not on supply counters or
   the order in which the operator settles. (Selection against a mutable
   remaining-supply table would let an operator who knows every pending `beta`
   route rare tiers to favored wallets purely by choosing settle order, and
   per-pull proof verification would never catch it.)
3. **One reveal per pull, enforced by cc-vrf.** `settle_pull` CPIs cc-vrf's
   `commit_proof_with_beta`, whose Light Protocol compressed account derives
   from `(authority, memo_hash = SHA-256(pull_address))` — a second commit for
   the same pull fails at the Light system program. The commit also proves (via
   validity proof against the registry) that the operator's authority record is
   **frozen**, unrevoked, and keyed by exactly `pool.operator`.
4. **Liveness has an escape hatch.** An operator can withhold a reveal (e.g.
   after privately computing an unfavorable `beta`), but `refund_pull` returns
   the buyer's entry fee and rent after `settle_deadline_slots`, and
   `withdraw_fees` can never touch pending buyers' escrow (the vault reserves
   `pending_pulls × entry_fee`). Withholding delays; it never steals.
5. **Verification story.** From the emitted events anyone can: recompute
   `alpha` from `(pull, client_seed)`, verify the proof with
   `@collectorcrypt/ecvrf`, reproduce the tier with `selectTier`, and check the
   registry commit. The operator's 32-byte Ed25519 seed is **both** its Solana
   signing key and its ECVRF key, so `pool.operator` equals the ECVRF public key.

Comparison: oracle VRFs (Switchboard On-Demand, MagicBlock VRF, ORAO) verify the
randomness proof **on-chain** at the cost of oracle fees, extra latency, and an
oracle-network liveness dependency. The cc-vrf pattern is cheaper and
self-operated, but trust is detection-based. Trust notes: cc-vrf's upgrade
authority was **not** renounced as of 2026-07-29 (contradicting its docs), and
its repo declares MIT but commits no LICENSE file.

## Required Versions

- **Rust**: See `rust-toolchain.toml`
- **Node.js**: See `.nvmrc`
- **pnpm**: See `package.json` `packageManager` field
- **Light CLI**: pinned in `justfile` (`zk_cli_version`), installed by `just setup`

## Build Commands

```bash
just build              # program .so → IDL → TS client → dist
just generate-idl       # Generate IDL via Codama (cargo build with build.rs)
just generate-clients   # Generate TypeScript + Rust clients from IDL
just build-program      # Build .so binary only (cargo build-sbf)
just test               # unit + integration + light + client tests
just unit-test          # Rust host unit tests (selection + alpha derivation)
just integration-test   # LiteSVM integration tests (builds the .so first)
just light-test         # Light-stack tests: real settle -> cc-vrf CPI w/ proofs
just dump-cc-vrf        # Fetch the mainnet cc-vrf binary for light-test
just client-test        # TypeScript client tests (parity + ECVRF + forged-reveal)
just burst-test 200     # Devnet: buy+settle 200 pulls, score the reveals + distribution
just burst-report       # Re-score every pull the burst pool has recorded (no txs)
just demo               # Off-chain operator/verifier demo (no RPC)
just fmt                # cargo fmt + prettier
just check              # fmt-check + lint-check
```

## Architecture

Solana program using **Pinocchio** (lightweight `no_std` framework) with **Codama**
for IDL-driven client generation.

### Client generation pipeline

```
Rust code with #[codama(...)] attributes
    ↓
program/build.rs → idl/gacha.json
    ↓
scripts/generate-clients.ts
    ↓
clients/{typescript,rust}/src/generated/   (gitignored; re-exported from src/index.ts / lib.rs)
```

### Program

- `program/src/lib.rs` — declares the program ID, wires modules
- `program/src/gacha.rs` — pure logic: `select_tier`, `derive_alpha`, prize constants (host unit-tested)
- `program/src/ccvrf.rs` — hand-built Anchor CPI to cc-vrf `commit_proof_with_beta` (program IDs, wire layout, account order)
- `program/src/instructions/` — `init_pool`, `buy_pull`, `settle_pull`, `refund_pull`, `withdraw_fees`, `claim_prize`, `emit_event` (self-CPI target) + `helpers/` (`checks`, `account`, `prize_nft` — the Token-2022 NFT mint + metadata CPIs)
- `program/src/state/` — `Pool`, `Pull` PDA structs + `Vault` / `PrizeMint` markers + `common.rs` (discriminator, pull status, PDA derivation)
- `program/src/event_engine.rs` — Anchor-compatible self-CPI event emission
- `program/src/events/` — one event struct per state-changing instruction
- `program/src/errors.rs` — error codes (100s generic / 200s pool / 300s pull / 400s settle+claim / 500s vault / 600s event)
- `program/src/tests.rs` — host unit tests for the pure logic

### Accounts

- **Pool** — PDA `["pool", admin]`. One machine per admin: `operator` (+ its cc-vrf
  `authority_label`), `entry_fee`, `settle_deadline_slots`, `tier_count`, fixed
  `weights`, monotonic `pulls_count`, and `pending_pulls` (open refund liabilities).
- **Pull** — PDA `["pull", pool, buyer, index_le]`. One per pull: `client_seed`,
  `alpha` (= `SHA-256(pull || client_seed)`), `beta` (set on reveal),
  `tier_selected`, `status` (Pending → Settled → Claimed), `requested_slot`,
  `settled_slot`. Closed on refund.
- **Vault** — program-owned, zero-data PDA `["vault", admin]` that escrows entry
  fees; invariant: balance ≥ rent floor + `pending_pulls × entry_fee`.
- **PrizeMint** — Token-2022 mint PDA `["mint", pull]`, created at claim:
  decimals 0, supply 1, mint authority discarded, `MetadataPointer` pointing at
  itself, `TokenMetadata` with `additional_metadata: [("rarity", <tier label>)]`.

### Lifecycle

`init_pool` (admin sets tiers, fee, deadline, operator + cc-vrf label) →
`buy_pull` (buyer pays fee + pull rent, supplies `client_seed`, status `Pending`) →
either `settle_pull` (operator: cc-vrf commit CPI + tier selection, status `Settled`)
or, past the deadline, `refund_pull` (buyer: fee + rent back, pull closed) →
`claim_prize` (anyone: mints the prize NFT to the buyer, status `Claimed`).
`withdraw_fees` (admin) drains settled revenue only. The 80-byte proof is never
stored on-chain — it is hashed into the cc-vrf commit and emitted in
`PullSettledEvent` for off-chain verification.

`settle_pull` and `claim_prize` are separate instructions because a settle
carries ~10 Light passthrough accounts + a 129-byte validity proof, and adding
the mint CPI stack would exceed the 1232-byte transaction limit. (A production
client could recombine them with an address lookup table.)

### Testing layers

- `tests/integration-tests` — LiteSVM 0.12: everything that does not need a live
  cc-vrf (init/buy/refund/withdraw, settle/claim negatives, claim decode via a
  fabricated settled pull with `set_account`). PDAs are derived through
  `gacha_client`'s generated `find_pda` helpers, so a seed the IDL gets wrong
  fails the suite rather than shipping to clients. Requires
  `just generate-clients` first — hence the recipe dependency.
- `tests/light-integration-tests` — `light-program-test`: the real
  `settle_pull` → cc-vrf → Light CPI chain with genuine validity proofs (local
  gnark prover, prepared by `just light-bootstrap`; binary + keys cached in
  `~/.config/light`). Runs against the mainnet-dumped `tests/fixtures/cc_vrf.so`.
  Single-threaded (shared prover port).
- `scripts/burst-randomness.ts` (`just burst-test <n>`) — devnet statistical test:
  opens and settles `n` pulls against a throwaway 1-lamport pool owned by
  `keys/burst-admin-keypair.json`, re-derives every reveal off-chain (alpha, the
  operator's ECVRF output, the selected tier, proof verification), and scores the
  tier distribution, beta bit balance, and beta byte uniformity, failing at
  p < 0.001. `just burst-report` re-scores the pool's whole history without
  spending anything. Costs ~0.0025 SOL of pull rent per pull, unrecoverable once
  a pull is settled — pull accounts are only closable while pending, via
  `refund_pull`.

## Conventions

- **Pinocchio, not Anchor**: use `pinocchio::AccountView`, `Address`, `ProgramResult`.
- **Packed state**: `#[repr(C, packed)]`, byte-0 discriminator, zero-copy `transmute`.
  Never take a reference to a packed field whose type has alignment > 1 (u32/u64
  arrays) — copy the field into a local first.
- **Light Protocol addresses come from `light-sdk-types`**, not local literals.
  cc-vrf publishes no crate, so its program ID, CPI authority, and instruction
  discriminator are still declared in `ccvrf.rs`.
- **Foreign CPIs are hand-serialized**: Anchor programs (cc-vrf) take an 8-byte
  `sha256("global:<name>")` discriminator + borsh args; SPL interface programs
  (token-metadata) take an 8-byte `SplDiscriminate` hash + borsh args. Program
  IDs and discriminators are constants next to the builder that uses them.
- **No `mod.rs` business logic**: module declarations and re-exports only.
- **No code comments** for logic — prefer clear names; use `///` doc comments.
- **Codama attributes drive IDL**: array field types must use a **literal** size
  (`[u32; 8]`, not `[u32; MAX_TIERS]`), and Codama cannot express arrays of custom
  structs — hence primitive tier arrays. `just generate-idl && git diff` catches drift.
- **Cross-language parity**: `select_tier`/`selectTier` and
  `derive_alpha`/`pullAlpha` must stay byte-for-byte identical; both pairs are
  pinned by shared fixtures in their respective test suites.

When extending: keep `#[codama(...)]` attributes in sync, emit an event per new
instruction, and add an integration test per instruction in `tests/integration-tests/`.

## Program ID

`Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS` (keypair in `keys/`, gitignored)
