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

just webapp-dev                 # or: pnpm --filter gacha-webapp dev
```

For the full reveal loop you also need a deployed program, a pool, and a running operator — see `just deploy-devnet`, `just setup-pool`, `just register-operator`, and `just operator-watch` in the root `justfile`, and the corresponding scripts under `scripts/`.

## Env vars

| Variable               | Description                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `VITE_DEFAULT_CLUSTER` | Cluster the app opens on: `solana:devnet` \| `solana:mainnet` \| `solana:localnet`          |
| `VITE_POOL_ADMIN`      | Admin pubkey of the featured pool; if unset, the app discovers pools on-chain               |
| `VITE_DEVNET_RPC_URL`  | Devnet RPC (needs Photon indexing for the reveal path); falls back to the public devnet RPC |
| `VITE_MAINNET_RPC_URL` | Mainnet RPC; falls back to the public mainnet-beta RPC (heavily rate-limited)               |

## Routes

| Route     | Description                                  |
| --------- | -------------------------------------------- |
| `/`       | Play — pool summary, buy, reveal, your pulls |
| `/verify` | Verify a pull's fairness by address          |
| `/admin`  | Create and manage a pool                     |

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, `@solana/kit` v7, `@solana/kit-plugin-wallet`, `@solana/react`, SWR, sonner.
