# Agent guide

Solana program examples in three flavors per example: `anchor/`, `native/`, `pinocchio/` (a few have `asm/`). Path convention: `<category>/<example-name>/<framework>`.

## Layout rules

- **Not a pnpm workspace, on purpose.** Every example has its own `package.json` and `pnpm-lock.yaml` so it can be copied out and run standalone. Never introduce cross-example imports or shared JS helpers. Align dependency versions with `pnpm sync-package-json` from the root.
- **Rust is one workspace.** Most program crates are members of the root `Cargo.toml`. Crates that can't be members are listed in `.github/.workspace-ignore` (CI enforces one or the other). `tokens/token-2022/transfer-hook/block-list/pinocchio` and `games/world-cup/pinocchio` have their own workspaces.
- Toolchain pins: `rust-toolchain.toml`, `.nvmrc`, `packageManager` in the root `package.json`, `anchor_version`/`solana_version` in every `Anchor.toml`.

## Build and test

| Framework          | Build + test                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| anchor             | `anchor test` in the project (`[scripts] test` in `Anchor.toml` runs mocha)                         |
| native / pinocchio | `pnpm build-and-test` (cargo build-sbf into `tests/fixtures/`, then `pnpm test`)                    |
| asm                | same script shape; programs assemble with `sbpf` (rev pinned in `.github/actions/setup/action.yml`) |
| world-cup          | `just setup && just build && just test` — excluded from the pinocchio workflow by design            |

Rust integration tests live in `program/tests/*.rs` (litesvm) and run with `cargo test --manifest-path=./program/Cargo.toml`; CI runs them only when `program/Cargo.toml` exists.

## Test stack (do not deviate)

- Runner: **mocha 11 via tsx** (`mocha --import=tsx …`). Never ts-mocha, ts-node, jest, or `node:test` imports — `node:test` suites under mocha exit 0 even when failing.
- Runtime: **LiteSVM**. Non-anchor tests use `@solana/kit` + `litesvm` 1.x (pattern: `basics/hello-solana/native/tests/index.test.ts`, full version `tokens/create-token/pinocchio/tests/test.ts`). Anchor tests use `@anchor-lang/core` + `anchor-litesvm` + `litesvm` 0.8 with `@solana/web3.js` — deliberate, anchor's JS client is web3.js-based until it moves to kit.
- litesvm never throws on a failed transaction: assert `result instanceof FailedTransactionMetadata`. Sending the same bytes twice needs `svm.expireBlockhash()` in between.
- anchor-litesvm pins its own old litesvm; every anchor project carries `pnpm.overrides { "litesvm": "^0.8.0" }`. Without it, failed transactions pass `instanceof` checks silently.
- Tests must assert real post-state (account bytes, lamport deltas) and fail loudly — verify by breaking an assertion once.

## Formatting and CI

- TS/MD/JSON: `pnpm format` / `pnpm run check` at the root (prettier, `@solana/prettier-config-solana`). Rust: `cargo fmt` at the root (shared `rustfmt.toml`); clippy runs with `-D warnings` in CI.
- Workflows discover projects by directory name (`anchor`, `native`, `pinocchio`, `asm`). `.github/.ghaignore` lists CI-skipped projects — every entry needs a comment with the real reason; verify a reason still holds before trusting it.
- Per-project CI: `pnpm install --frozen-lockfile` (commit lockfiles), `tsc --noEmit` when a `tsconfig.json` exists (keep `skipLibCheck`), build, test.

## Gotchas that have bitten before

- **Resolver-2 feature unification:** a crate must declare every feature-gated dependency it uses itself (e.g. `solana-address` with `curve25519`/`decode`). Whole-workspace builds mask missing features that per-crate CI builds expose.
- **`anchor keys sync` rewrites `declare_id!` and strips Anchor.toml comments.** Don't run it casually; `basics/cross-program-invocation/anchor` has committed keypairs with a drift guard — never resync it.
- Fixtures under `tests/fixtures/` are gitignored and built on demand; Metaplex `token_metadata.so` is dumped from mainnet by each project's `prepare.mjs` postinstall. The metadata natives build Metaplex instructions by hand in `mpl_util.rs` — there is no mpl crate dependency; keep it that way.
- Old runtimes (bankrun) and old harnesses were removed deliberately; don't reintroduce them from upstream examples or old tutorials.
