# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A provably-fair **gacha** (loot-box / pack-pull) game on Solana, modeled on how
platforms like Collector Crypt and Phygitals actually work. An admin configures a
pool of weighted reward tiers with limited supply and a fixed entry fee, and
registers an off-chain VRF operator. A buyer pays the fee to open a pull, which
commits a fixed VRF input (`alpha`, the pull account's own address) **before** any
randomness is known. The operator then reveals the ECVRF output (`beta`) for that
input; the program expands `beta` into a weighted tier selection and records it.

## Randomness model (important)

This follows the pattern shipped by Collector Crypt's [`cc-vrf`](https://vrf.collectorcrypt.com)
using RFC 9381 `ECVRF-EDWARDS25519-SHA512-TAI`. **Solana cannot verify an ECVRF
proof on-chain** (no ed25519-ECVRF precompile), so:

- On-chain, the program trusts the registered operator's **signature** on `settle_pull`.
- Off-chain, anyone verifies `beta = VRF(alpha)` with `@collectorcrypt/ecvrf` and
  reproduces the tier via `selectTier` (a byte-for-byte mirror of the on-chain
  `select_tier`).

Fairness comes from `alpha` being fixed at commit (the buyer/operator cannot grind
it) and the proof being publicly verifiable. Liveness caveat: an operator can
withhold a reveal (selective abort); a production system would add a timeout/refund.

The operator's 32-byte Ed25519 seed is **both** its Solana signing key and its ECVRF
key, so `pool.operator` (a Solana address) equals the ECVRF public key.

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
just unit-test          # Rust host unit tests (pure selection logic)
just integration-test   # LiteSVM integration tests (builds the .so first)
just client-test        # TypeScript client tests (parity + ECVRF round-trip)
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
- `program/src/gacha.rs` — pure logic: `select_tier` weighted selection (host unit-tested)
- `program/src/instructions/` — `init_pool`, `buy_pull`, `settle_pull`, `emit_event` (self-CPI target) + `helpers/`
- `program/src/state/` — `Pool`, `Pull` PDA structs + `Vault` marker + `common.rs` (discriminator, pull status, PDA derivation)
- `program/src/event_engine.rs` — Anchor-compatible self-CPI event emission
- `program/src/events/` — one event struct per state-changing instruction
- `program/src/errors.rs` — error codes (100s generic / 200s pool / 300s pull / 400s settle / 500s vault / 600s event)
- `program/src/tests.rs` — host unit tests for `select_tier`

### Accounts

- **Pool** — PDA `["pool", admin]`. One machine per admin: `operator`, `entry_fee`,
  `tier_count`, parallel `weights`/`supplies`/`remaining` arrays (up to `MAX_TIERS`),
  and a monotonic `pulls_count`.
- **Pull** — PDA `["pull", pool, buyer, index_le]`. One per pull: `alpha` (= its own
  address), `beta` (set on reveal), `tier_selected`, `status`, `settled_slot`.
- **Vault** — program-owned, zero-data PDA `["vault", admin]` that escrows entry fees.

### Lifecycle

`init_pool` (admin sets tiers + operator; creates Pool + Vault) → `buy_pull` (buyer
pays the fee, which funds the Pull rent with the remainder escrowed to the vault;
commits `alpha`, status `Pending`) → `settle_pull` (operator signs, supplies `beta` +
proof; the program selects a tier weighted by live supply, decrements it, records the
result, status `Settled`). The proof is emitted in `PullSettledEvent` for off-chain
verification, not stored on-chain.

## Conventions

- **Pinocchio, not Anchor**: use `pinocchio::AccountView`, `Address`, `ProgramResult`.
- **Packed state**: `#[repr(C, packed)]`, byte-0 discriminator, zero-copy `transmute`.
  Never take a reference to a packed field whose type has alignment > 1 (u32/u64
  arrays) — copy the field into a local first.
- **No `mod.rs` business logic**: module declarations and re-exports only.
- **No code comments** for logic — prefer clear names; use `///` doc comments.
- **Codama attributes drive IDL**: array field types must use a **literal** size
  (`[u32; 8]`, not `[u32; MAX_TIERS]`), and Codama cannot express arrays of custom
  structs — hence the parallel primitive tier arrays. `just generate-idl && git diff`
  catches drift.
- **selectTier parity**: `program/src/gacha.rs::select_tier` and
  `clients/typescript/src/gacha.ts::selectTier` must stay byte-for-byte identical;
  both are pinned by the same fixtures in their respective test suites.

When extending: keep `#[codama(...)]` attributes in sync, emit an event per new
instruction, and add an integration test per instruction in `tests/integration-tests/`.

## Program ID

`Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS` (keypair in `keys/`, gitignored)
