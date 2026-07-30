# Light-stack integration tests

Tests that exercise the real `settle_pull` → cc-vrf → Light Protocol CPI chain
with genuine validity proofs, against the mainnet-dumped cc-vrf binary
(`../fixtures/cc_vrf.so`, populated by `just dump-cc-vrf`).

This crate is a **standalone workspace**: `light-program-test` pins litesvm 0.7 /
solana-sdk 2.3, which cannot coexist in one dependency graph with the litesvm
0.12 suite in `../integration-tests`.

## Test files

- `tests/gacha_settle.rs` — the gacha lifecycle against the real registry:
    - settle happy path: tier recorded from `beta`, `pending_pulls` decremented,
      and the reveal anchored as a compressed account at
      `(authority, sha256(pull))` with the exact hashes and `beta`
    - settle replay rejected, twice over: a re-roll through the gacha program
      fails on the pull status, and a direct cc-vrf commit that bypasses gacha
      entirely is blocked by Light address uniqueness
    - settle by an unfrozen authority rejected (the program pins `frozen = true`
      into the proof-bound record, so the hash cannot match)
    - settle by an unregistered operator rejected (record owner/pk are serialized
      from pool state, so another operator's record cannot be substituted)
    - claim after a real settle: full Token-2022 mint TLV decode (name, symbol,
      URI, `rarity` field, supply 1, mint authority discarded)
    - refund after settle rejected
- `tests/cc_vrf_lifecycle.rs` — the original spike proving the cc-vrf binary
  works in this harness: `init_authority` → `freeze_authority` →
  `commit_proof_with_beta` → replay rejected (`Custom(14201)`, the batched
  address queue's duplicate check).
- `tests/common/mod.rs` — shared cc-vrf plumbing: borsh mirrors of the IDL
  types, discriminators, and builders for registering/freezing an authority and
  committing a proof. The committed `fixtures/cc_vrf_idl.json` is cc-vrf's own
  Anchor IDL, kept for reference.

## Environment setup

```bash
just light-bootstrap   # from games/gacha/pinocchio/ — idempotent
```

The recipe encodes three quirks of the pinned Light CLI (0.28.4, installed by
`just setup`):

1. **`spl_noop.so` is missing from CLI 0.28.x** but required by
   `light-program-test`'s program loader — it is restored into the CLI's `bin/`
   from the `@lightprotocol/zk-compression-cli@0.27.1-alpha.2` npm tarball.
2. **Proving keys are pre-downloaded** (~35 MB from Light's CDN into
   `~/.config/light/proving-keys/` — worth caching in CI):
   `v2_inclusion_32_{1,2}.key`, `v2_non-inclusion_40_{1,2}.key`,
   `v2_combined_32_40_{1_1,1_2,2_1}.key`, and `CHECKSUM`. The test harness's
   own prover auto-spawn points at a dead GCS bucket, so it must never trigger.
3. **The prover binary (pinned) is started directly**, with
   `--download-url` pointing at Light's CDN, if nothing is listening on :3001;
   the test harness detects the running prover and skips spawning. It must NOT
   be started through `light start-prover`: the CLI passes no download URL, and
   the binary's default is the same dead GCS bucket — the prover then
   re-validates keys against it on every prove request and fails them all
   (requests hang in client-side retry forever).

Version pinning matters: the CLI's bundled Light programs must match the CDN's
current proving keys. 0.27.x pairs with a key set that is no longer served
(`6043 ProofVerificationFailed` with today's keys).

## Running

```bash
just light-test        # bootstraps the prover, builds the .so, dumps cc-vrf, runs the tests
# or, with the environment already prepared:
cd tests/light-integration-tests && cargo test -- --test-threads=1
```

Single-threaded: concurrent test binaries would race on the prover port. A full
run is a few seconds once the prover is up; proofs cost ~30 ms each.

## Environment quirks the tests encode

- `LightProgramTest` stays at slot 0 — don't assert non-zero
  `requested_slot`/`settled_slot` here.
- The rent sysvar is rewritten at setup: pinocchio 0.11 reads the sysvar's
  first u64 as the effective lamports-per-byte rate (agave v3 semantics, 6960),
  while this crate's agave 2.x runtime serves the legacy
  `{3480, threshold: 2.0}` layout. Setting `{6960, threshold: 1.0}` makes both
  readers compute identical minimums.
- cc-vrf's `init_authority` has TWO named accounts (`owner` signer +
  `system_program`); freeze/commit have only `owner`. Compressed-account data
  is pure borsh (no 8-byte prefix — the discriminator is a separate field).
