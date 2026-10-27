# Agent guide

Solana program examples, one per framework flavor (`anchor/`, `native/`, `pinocchio/`, a few `asm/`). Everything below is a decision or trap you cannot see from the files.

## Deliberate structure

- **Not a pnpm workspace, on purpose.** Per-example `package.json` + `pnpm-lock.yaml` so an example can be copied out and run standalone. No cross-example imports, no shared JS helpers. Version alignment is `pnpm sync-package-json` from the root, not hoisting.
- Rust program crates must be root-workspace members or listed in `.github/.workspace-ignore` (CI enforces one or the other).
- `.github/.ghaignore` lists CI-skipped projects; every entry needs a comment with the real reason, and reasons rot: verify before trusting one.
- `games/world-cup` is excluded from the pinocchio workflow by design (own workspace, `just` build).

## Test stack (do not deviate)

- Non-anchor tests: TypeScript, mocha via tsx, `@solana/kit` + litesvm 1.x. Never `node:test` imports: `node:test` suites under mocha exit 0 even when failing.
- Anchor tests: Rust only, in `programs/<prog>/tests/*.rs` on the litesvm crate, built from the program's own `instruction::X`, `accounts::X` and `try_deserialize` (Anchor 1.2's default template). No JS harness, `package.json` or web3.js in anchor examples; `[scripts] test = "cargo test"`, and CI runs it through `anchor test --skip-build --skip-local-validator --skip-deploy`.
- litesvm never throws on a failed transaction: in TS assert `result instanceof FailedTransactionMetadata`. Resending identical bytes needs `expireBlockhash()` in between (both languages).
- bankrun and the older harnesses were removed deliberately; don't reintroduce them from upstream examples or old tutorials.

## Traps

- **Resolver-2 feature unification:** each crate must declare every feature-gated dependency it uses itself (e.g. `solana-address` with `curve25519`/`decode`). Whole-workspace builds mask what per-crate CI builds expose.
- **`anchor keys sync` rewrites `declare_id!` and strips Anchor.toml comments.** `basics/cross-program-invocation/anchor` has committed keypairs with a drift guard: never resync it.
- **Non-anchor examples track latest and carry no pnpm overrides.** Fix an advisory by bumping the direct dependency, not by pinning a transitive one.
- **kit 8 signer metas:** a hand-built `{ role: AccountRole.WRITABLE_SIGNER, signer }` in an object literal widens `role` to `AccountRole`, and `signTransactionMessageWithSigners` then rejects the message. Write `AccountRole.WRITABLE_SIGNER as const`.
- **Native programs use the component crates** (`solana-account-info`, `solana-cpi`, `solana-msg`, `solana-program-entrypoint`, `solana-program-error`, `solana-pubkey`, `solana-sysvar`...), not `solana-program`. `solana-program` 5 moved to `solana-instruction` 4 while the system/spl interfaces, anchor and litesvm are still on 3, so its `invoke` rejects their instructions.
- **litesvm caps the root workspace:** it pins `solana-address ~2.7`, `solana-rent ~4.4` and `solana-instruction ~3.5`, and the root `Cargo.lock` is shared, so nothing in the workspace can take a newer minor of those (e.g. `solana-pubkey` stays on 4.3, which needs `solana-address` 2.7). Bump them only after litesvm does.
- **TypeScript 7 ships only the `tsc` CLI** (no `require('typescript')` API), and dropped `moduleResolution: node`. Anything that loads the compiler programmatically breaks on it.
- Metaplex `token_metadata.so` is dumped from mainnet by each project's `prepare.mjs` postinstall. The metadata natives hand-build Metaplex instructions in `mpl_util.rs`, with no mpl crate dependency: keep it that way.
