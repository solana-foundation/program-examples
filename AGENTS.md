# Agent guide

Solana program examples, one per framework flavor (`anchor/`, `native/`, `pinocchio/`, a few `asm/`). Everything below is a decision or trap you cannot see from the files.

## Deliberate structure

- **Not a pnpm workspace, on purpose.** Per-example `package.json` + `pnpm-lock.yaml` so an example can be copied out and run standalone. No cross-example imports, no shared JS helpers. Version alignment is `pnpm sync-package-json` from the root, not hoisting.
- Rust program crates must be root-workspace members or listed in `.github/.workspace-ignore` (CI enforces one or the other).
- `.github/.ghaignore` lists CI-skipped projects; every entry needs a comment with the real reason, and reasons rot: verify before trusting one.
- `games/world-cup` is excluded from the pinocchio workflow by design (own workspace, `just` build).

## Test stack (do not deviate)

- Runner is mocha via tsx. Never `node:test` imports: `node:test` suites under mocha exit 0 even when failing.
- Non-anchor tests: `@solana/kit` + litesvm 1.x. Anchor tests: `@anchor-lang/core` + `anchor-litesvm` + litesvm **0.8** with `@solana/web3.js`: deliberate, anchor's JS client stays web3.js-based until it moves to kit.
- anchor-litesvm pins its own old litesvm, so every anchor project carries `pnpm.overrides { "litesvm": "^0.8.0" }`. Without it, failed transactions pass `instanceof` checks silently and tests go green.
- litesvm never throws on a failed transaction: assert `result instanceof FailedTransactionMetadata`. Resending identical bytes needs `svm.expireBlockhash()` in between.
- bankrun and the older harnesses were removed deliberately; don't reintroduce them from upstream examples or old tutorials.

## Traps

- **Resolver-2 feature unification:** each crate must declare every feature-gated dependency it uses itself (e.g. `solana-address` with `curve25519`/`decode`). Whole-workspace builds mask what per-crate CI builds expose.
- **`anchor keys sync` rewrites `declare_id!` and strips Anchor.toml comments.** `basics/cross-program-invocation/anchor` has committed keypairs with a drift guard: never resync it.
- Metaplex `token_metadata.so` is dumped from mainnet by each project's `prepare.mjs` postinstall. The metadata natives hand-build Metaplex instructions in `mpl_util.rs`, with no mpl crate dependency: keep it that way.
