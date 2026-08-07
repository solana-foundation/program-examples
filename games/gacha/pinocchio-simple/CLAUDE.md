# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A provably-fair **gacha** (loot-box / pack-pull) game on Solana — the simplified
sibling of `../pinocchio`. Where that variant anchors every reveal in Collector
Crypt's cc-vrf registry through a Light Protocol CPI, this one replaces the
whole external stack with a **self-certifying Token-2022 prize NFT**: the mint's
metadata carries the rarity plus the complete reveal provenance, so the evidence
travels with the prize. An admin configures a pool of fixed-weight reward tiers
and a fixed entry fee, and records an off-chain VRF operator. A buyer pays the
fee to open a pull, committing buyer-supplied entropy into the VRF input. The
operator reveals the ECVRF output (`beta`) with `settle_and_distribute`, which
selects the tier, mints the prize NFT straight to the buyer, and closes the
pull.

## Randomness model (important)

RFC 9381 `ECVRF-EDWARDS25519-SHA512-TAI`. **Solana cannot verify an ECVRF proof
on-chain** (no precompile), so the trust model is _detection, not prevention_:
on-chain the program accepts the registered operator's signed `beta`; off-chain
anyone can prove cheating. The design closes every gap that detection alone
leaves open:

1. **Fixed ≠ unpredictable.** `alpha = SHA-256(pull_address || client_seed)`
   where `client_seed` is 32 random bytes chosen by the buyer at commit. An
   alpha that is merely _fixed_ (say, the pull address alone) is worthless
   against the operator: `beta = VRF(operator_key, alpha)` is deterministic, so
   a predictable alpha lets the operator precompute every outcome before anyone
   buys. Buyer entropy is what makes the outcome unknowable at commit time.
2. **Fixed weights ⇒ order-independence.** Tier odds never change after init,
   so a pull's outcome depends only on its `beta` — not on supply counters or
   the order in which the operator settles.
3. **One reveal per pull, enforced structurally.** Pull PDAs are seeded by a
   monotonic pool index, so `buy_pull` can never re-derive an old address; the
   prize mint is a PDA of the pull whose creation fails if it already exists;
   and `settle_and_distribute` closes the pull account. No registry needed.
4. **The operator key is pinned.** `pool.operator` is fixed at init and doubles
   as the ECVRF public key, so the key can never be swapped mid-pool. (This is
   what replaces the sibling's frozen cc-vrf registry record — the registry
   additionally proved the record was frozen/unrevoked, but with the key pinned
   in immutable pool state that guarantee is redundant here.)
5. **Liveness has an escape hatch.** An operator can withhold a reveal (e.g.
   after privately computing an unfavorable `beta`), but `refund_pull` returns
   the buyer's entry fee and rent after `settle_deadline_slots`, and
   `withdraw_fees` can never touch pending buyers' escrow (the vault reserves
   `pending_pulls × entry_fee`). Withholding delays; it never steals.
6. **Verification story — the NFT is the evidence.** The prize mint's
   `additional_metadata` carries `rarity`, `pull`, `client_seed`, `beta`, and
   `proof` (lowercase hex). From the mint account alone anyone can recompute
   `alpha`, verify the proof with `@collectorcrypt/ecvrf` against
   `pool.operator`, and reproduce the tier with `selectTier` — the TS client
   ships this as `verifyPrizeProvenance`. The same data is emitted in
   `PullSettledEvent`. The operator's 32-byte Ed25519 seed is **both** its
   Solana signing key and its ECVRF key, so `pool.operator` equals the ECVRF
   public key.

Comparison: oracle VRFs (Switchboard On-Demand, MagicBlock VRF, ORAO) verify the
randomness proof **on-chain** at the cost of oracle fees, extra latency, and an
oracle-network liveness dependency. The `../pinocchio` sibling anchors reveals
in the cc-vrf registry via Light Protocol compressed accounts — stronger
third-party attestation, much heavier stack. This variant trades that
attestation for radical simplicity: the provenance lives in the prize itself,
at ~0.007 SOL of metadata rent per settle, paid by the operator.

## Required Versions

- **Rust**: See `rust-toolchain.toml`
- **Node.js**: See `.nvmrc`
- **pnpm**: See `package.json` `packageManager` field

## Build Commands

```bash
just build              # program .so → IDL → TS client → dist
just generate-idl       # Generate IDL via Codama (cargo build with build.rs)
just generate-clients   # Generate TypeScript + Rust clients from IDL
just build-program      # Build .so binary only (cargo build-sbf)
just test               # unit + integration + client tests
just unit-test          # Rust host unit tests (selection + alpha + hex)
just integration-test   # LiteSVM integration tests (builds the .so first)
just client-test        # TypeScript client tests (parity + ECVRF + provenance)
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
program/build.rs → idl/gacha_simple.json
    ↓
scripts/generate-clients.ts
    ↓
clients/{typescript,rust}/src/generated/   (gitignored; re-exported from src/index.ts / lib.rs)
```

### Program

- `program/src/lib.rs` — declares the program ID, wires modules
- `program/src/gacha.rs` — pure logic: `select_tier`, `derive_alpha`, `format_hex`, prize constants + metadata keys (host unit-tested)
- `program/src/instructions/` — `init_pool`, `buy_pull`, `settle_and_distribute`, `refund_pull`, `withdraw_fees`, `emit_event` (self-CPI target) + `helpers/` (`checks`, `account`, `prize_nft` — the Token-2022 NFT mint + metadata CPIs)
- `program/src/state/` — `Pool`, `Pull` PDA structs + `Vault` / `PrizeMint` markers + `common.rs` (discriminator, PDA derivation)
- `program/src/event_engine.rs` — Anchor-compatible self-CPI event emission
- `program/src/events/` — one event struct per state-changing instruction
- `program/src/errors.rs` — error codes (100s generic / 200s pool / 300s pull / 400s settle / 500s vault / 600s event); codes are stable, gaps from the sibling's removed cc-vrf errors are intentional
- `program/src/tests.rs` — host unit tests for the pure logic

### Accounts

- **Pool** — PDA `["pool", admin]`. One machine per admin: `operator` (fixed at
  init; doubles as the ECVRF public key), `entry_fee`, `settle_deadline_slots`,
  `tier_count`, fixed `weights`, monotonic `pulls_count`, and `pending_pulls`
  (open refund liabilities).
- **Pull** — PDA `["pull", pool, buyer, index_le]`. One per _pending_ pull:
  `client_seed`, `alpha` (= `SHA-256(pull || client_seed)`), `requested_slot`.
  The account existing ⇔ the pull is pending; both settle and refund close it
  (rent back to the buyer). No status byte, no stored `beta`.
- **Vault** — program-owned, zero-data PDA `["vault", admin]` that escrows entry
  fees; invariant: balance ≥ rent floor + `pending_pulls × entry_fee`.
- **PrizeMint** — Token-2022 mint PDA `["mint", pull]`, created at settle:
  decimals 0, supply 1, mint authority discarded, `MetadataPointer` pointing at
  itself, `TokenMetadata` with `additional_metadata`:
  `rarity`, `pull`, `client_seed`, `beta`, `proof` (all but `rarity` lowercase
  hex; `alpha` is omitted because it is derivable from `pull` + `client_seed`).
  Its existence doubles as the once-only settle guard.

### Lifecycle

`init_pool` (admin sets tiers, fee, deadline, operator) →
`buy_pull` (buyer pays fee + pull rent, supplies `client_seed`) →
either `settle_and_distribute` (operator: tier selection + prize NFT mint to the
buyer + pull close, ~82k CU) or, past the deadline, `refund_pull` (buyer: fee +
rent back, pull closed). `withdraw_fees` (admin) drains settled revenue only.

Unlike the sibling, settle and claim are a single instruction: without the ~10
Light passthrough accounts and 129-byte validity proof, the whole flow fits in
one ~615-byte transaction with 11 accounts.

### Testing layers

- `tests/integration-tests` — LiteSVM: the **entire** lifecycle including the
  settle-and-mint happy path (the sibling needs light-program-test + a local
  gnark prover for that). PDAs are derived through `gacha-simple-client`'s
  generated `find_pda` helpers, so a seed the IDL gets wrong fails the suite
  rather than shipping to clients. Requires `just generate-clients` first —
  hence the recipe dependency. The settle happy path also replays the full
  provenance verification from the minted metadata. The program never verifies
  the ECVRF proof on-chain, so tests pass arbitrary proof bytes.
- `clients/typescript/test` — parity fixtures (pinned against the Rust unit
  tests), real ECVRF prove/verify round-trips, forged-reveal detection, and
  `verifyPrizeProvenance` acceptance/tampering cases.
- `CU_REPORT=1 cargo test -p tests-gacha-simple` writes per-instruction minimum
  CU to `cu_report.md` (settle_and_distribute ≈ 82k of the 200k default).

## Conventions

- **Pinocchio, not Anchor**: use `pinocchio::AccountView`, `Address`, `ProgramResult`.
- **Packed state**: `#[repr(C, packed)]`, byte-0 discriminator, zero-copy `transmute`.
  Never take a reference to a packed field whose type has alignment > 1 (u32/u64
  arrays) — copy the field into a local first.
- **Foreign CPIs are hand-serialized**: SPL interface programs (token-metadata)
  take an 8-byte `SplDiscriminate` hash + borsh args. Program IDs and
  discriminators are constants next to the builder that uses them.
- **No `mod.rs` business logic**: module declarations and re-exports only.
- **No code comments** for logic — prefer clear names; use `///` doc comments.
- **Codama attributes drive IDL**: array field types must use a **literal** size
  (`[u32; 8]`, not `[u32; MAX_TIERS]`), and Codama cannot express arrays of custom
  structs — hence primitive tier arrays. `just generate-idl && git diff` catches drift.
- **Cross-language parity**: `select_tier`/`selectTier` and
  `derive_alpha`/`pullAlpha` must stay byte-for-byte identical; both pairs are
  pinned by shared fixtures in their respective test suites. The fixtures are
  also byte-identical to `../pinocchio`'s — the two programs share the same
  draw semantics by design.

When extending: keep `#[codama(...)]` attributes in sync, emit an event per new
instruction, and add an integration test per instruction in `tests/integration-tests/`.

## Program ID

`2nAHovvq1Ju2VZtZWvaAyvTrD18DRzG5pBEUwwGQDAWS` (keypair in `keys/`, gitignored)
