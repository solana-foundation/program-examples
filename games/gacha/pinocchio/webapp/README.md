# Gacha Webapp

A provably-fair gacha (loot-box) front-end wired to the on-chain `gacha` program. Connect a wallet, open a pull, watch the pack "open" as an off-chain operator settles it against Collector Crypt's `cc-vrf` registry, then claim the Token-2022 prize NFT. Built on `@solana/kit` v7 with the latest kit wallet plugins (`@solana/kit-plugin-wallet` + `@solana/react` + `@solana/kit-plugin-rpc`).

## Features

- **Wallet connect** — any Wallet Standard wallet, via `@solana/kit-plugin-wallet` + `@solana/react`
- **Cluster switch** — devnet / mainnet / localnet, persisted locally
- **Open a pull** — pays the pool's entry fee and mixes in fresh client-side entropy
- **Pack-opening reveal** — live-polls the pull account until the operator settles it, then reveals the rarity
- **Claim** — mints the Token-2022 prize NFT (rarity carried in its metadata) to the buyer
- **Refund** — reclaim the entry fee once the settle deadline has passed and no reveal has landed
- **Client-side fairness verification** — recompute `alpha`, reproduce the tier from the on-chain `beta`, optionally paste an ECVRF proof to check
- **Dev admin panel** — create a pool, withdraw settled fees

## How the reveal works

Opening a pull is two steps, on purpose — this is how real gacha sites work, not a simplification. The browser sends `buy_pull` and then polls the pull account; it never reveals anything itself. A backend **operator** does the reveal: it proves the ECVRF output for the pull's `alpha`, anchors that proof as a one-time commit in Collector Crypt's `cc-vrf` registry (via a Light Protocol CPI), and calls `settle_pull`. Once that lands, the poll picks up the new status and rarity and the UI unlocks the claim button.

The operator is the `scripts/register-operator.ts` (one-time: registers + freezes the operator's cc-vrf authority) and `scripts/operator-settle.ts` (the crank: watches for pending pulls and settles them) pair — see the `just register-operator` and `just operator-watch` recipes. The canonical, tested settle wiring — the exact accounts, Light validity proof, and CPI layout — lives in the Rust integration suite at `tests/light-integration-tests`; the scripts follow that reference.

## Local reveal simulator

Preview the complete SIMD pack flow without a wallet, RPC connection, deployed program, or devnet transaction:

```bash
just webapp-simd-preview
# or: pnpm --filter gacha-webapp dev:simd
```

The command opens `http://localhost:5173/simd-preview.html`. The standalone reveal lab can select any card, switch between pending and locally settled states, replay the pack animation, and simulate claiming. All state is kept in browser memory, and the standalone HTML/JavaScript entry is not included in the default production build.

## Cluster support matrix

| Cluster  | Buy | Refund | Reveal + Claim                                                    |
| -------- | --- | ------ | ----------------------------------------------------------------- |
| Devnet   | ✓   | ✓      | ✓ — cc-vrf, Light Protocol, and a Photon RPC are all live         |
| Mainnet  | ✓   | ✓      | ✓ — same stack, live on mainnet                                   |
| Localnet | ✓   | ✓      | ✗ — a plain local validator has neither cc-vrf nor Light deployed |

On localnet the reveal UI shows a note explaining why settle/claim aren't reachable there.

## Quickstart

From the repo root (`games/gacha/pinocchio`):

```bash
pnpm install
just build-client              # builds @solana/gacha, the webapp's workspace dep

cp webapp/.env.example webapp/.env.local
# edit webapp/.env.local:
#   VITE_DEFAULT_CLUSTER=solana:devnet
#   VITE_DEVNET_RPC_URL=<a Photon-capable RPC, e.g. Helius>
#   VITE_POOL_ADMIN=<the admin pubkey printed by setup-pool>

just webapp-dev                 # starts the reveal operator + Vite
```

`just webapp-dev` loads the Photon RPC from `webapp/.env.local`, starts the operator watcher, and then starts Vite. When Vite exits, it stops the local watcher too. Use `just webapp-ui` when you want only the browser app because an operator is already running elsewhere.

The operator must be registered once before using the combined command. For a fresh deployment, run `just deploy-devnet`, `just register-operator`, and `just setup-pool` first. You can also run the watcher independently with `just operator-watch`; it loads the same local RPC configuration.

The combined command is for local development. In production, run `scripts/operator-settle.ts --watch` as a persistent server-side worker and give it a server-only `RPC_URL`. The operator key must never enter the browser bundle; note that every `VITE_` variable is browser-visible.

## Env vars

| Variable               | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `VITE_DEFAULT_CLUSTER` | Cluster the app opens on: `solana:devnet` \| `solana:mainnet` \| `solana:localnet` |
| `VITE_POOL_ADMIN`      | Admin pubkey of the featured pool; if unset, the app discovers pools on-chain      |
| `VITE_DEVNET_RPC_URL`  | Photon-capable devnet RPC shared by the browser and local operator                 |
| `VITE_MAINNET_RPC_URL` | Mainnet RPC; falls back to the public mainnet-beta RPC (heavily rate-limited)      |
| `RPC_URL`              | Server-only Photon RPC override used by operator CLI processes                     |

## Routes

| Route     | Description                                  |
| --------- | -------------------------------------------- |
| `/`       | Play — pool summary, buy, reveal, your pulls |
| `/verify` | Verify a pull's fairness by address          |
| `/admin`  | Create and manage a pool                     |

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, `@solana/kit` v7, `@solana/kit-plugin-wallet`, `@solana/react`, SWR, sonner.
