# CLAUDE.md

Provably-fair gacha (loot-box) game: admin configures fixed-weight reward tiers and an entry fee plus an off-chain VRF operator; a buyer commits entropy and pays, the operator reveals an ECVRF `beta`, the program anchors the proof in Collector Crypt's real [`cc-vrf`](https://vrf.collectorcrypt.com) registry by CPI, expands `beta` into a tier, and mints a Token-2022 NFT whose metadata carries a `rarity` field.

Below is only what the code, the `justfile`, and the IDL do not tell you.

## Randomness model (read before touching anything)

RFC 9381 `ECVRF-EDWARDS25519-SHA512-TAI`, following cc-vrf. **Solana cannot verify an ECVRF proof on-chain** (no precompile), so the trust model is _detection, not prevention_: on-chain the program accepts the registered operator's signed `beta`. Each design choice closes a gap detection alone leaves open:

1. **Buyer entropy in alpha.** `alpha = SHA-256(pull_address || client_seed)`, `client_seed` chosen by the buyer at commit. `beta = VRF(operator_key, alpha)` is deterministic, so a merely _fixed_ alpha (the pull address alone) lets the operator precompute every outcome before anyone buys.
2. **Fixed weights give order-independence.** Tier odds never change after init, so an outcome depends only on its `beta`. Selecting against a mutable remaining-supply table would let an operator who knows every pending `beta` route rare tiers to favored wallets by choosing settle order, and per-pull proof verification would never catch it.
3. **One reveal per pull, enforced externally.** `settle_pull` CPIs cc-vrf `commit_proof_with_beta`, whose Light Protocol compressed account derives from `(authority, memo_hash = SHA-256(pull_address))`, so a second commit fails at the Light system program. The commit also proves the operator's authority record is frozen, unrevoked, and keyed by exactly `pool.operator`.
4. **Withholding delays, never steals.** `refund_pull` returns fee + rent after `settle_deadline_slots`, and the vault reserves `pending_pulls × entry_fee` so `withdraw_fees` can never touch pending escrow.
5. **The operator's 32-byte Ed25519 seed is both its Solana signing key and its ECVRF key**, so `pool.operator` equals the ECVRF public key and the emitted events are enough to reverify a pull off-chain.

Oracle VRFs (Switchboard On-Demand, MagicBlock VRF, ORAO) verify on-chain at the cost of fees, latency, and oracle liveness; the cc-vrf pattern trades that for detection-based trust. Trust notes: cc-vrf's upgrade authority was **not** renounced as of 2026-07-29 (contradicting its docs), and its repo declares MIT but commits no LICENSE file.

## Gotchas

- `settle_pull` and `claim_prize` are separate instructions because a settle carries ~10 Light passthrough accounts + a 129-byte validity proof; adding the mint CPI stack blows the 1232-byte transaction limit. (A production client could recombine them with a lookup table.)
- The 80-byte proof is never stored on-chain: it is hashed into the cc-vrf commit and emitted in `PullSettledEvent`.
- **Packed state:** never take a reference to a `#[repr(C, packed)]` field whose type has alignment > 1 (u32/u64 arrays); copy into a local first.
- **Codama limits:** array field types need a **literal** size (`[u32; 8]`, not `[u32; MAX_TIERS]`), and Codama cannot express arrays of custom structs, hence the primitive tier arrays. `just generate-idl && git diff` is the drift check.
- **Cross-language parity:** `select_tier`/`selectTier` and `derive_alpha`/`pullAlpha` must stay byte-for-byte identical; shared fixtures in both suites pin them.
- Light Protocol addresses come from `light-sdk-types`. cc-vrf publishes no crate, so its program ID, CPI authority, and instruction discriminator are declared locally in `ccvrf.rs`; foreign CPIs are hand-serialized (Anchor: 8-byte `sha256("global:<name>")` + borsh; SPL interface: 8-byte `SplDiscriminate` + borsh).
- Integration tests derive PDAs through `gacha_client`'s generated `find_pda` helpers on purpose, so a seed the IDL gets wrong fails the suite instead of shipping. They need `just generate-clients` first.
- `just light-test` runs single-threaded (shared local gnark prover port, prepared by `just light-bootstrap`, cached in `~/.config/light`) against the mainnet-dumped `tests/fixtures/cc_vrf.so`.
- `just burst-test <n>` spends devnet SOL: ~0.0025 SOL of pull rent per pull, unrecoverable once a pull is settled (pulls are only closable while pending, via `refund_pull`). `just burst-report` re-scores history for free.
- When extending: keep `#[codama(...)]` attributes in sync, emit an event per new instruction, add an integration test per instruction.

Program ID `Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS` (keypair in `keys/`, gitignored).
