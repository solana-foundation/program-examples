# Gacha Webapp

A Next.js App Router frontend for the Pinocchio gacha program. A player approves one `buy_pull` transaction; the browser sends its signed bytes to `POST /api/pull`, which submits the buy, produces and anchors the operator's cc-vrf reveal, settles the pull, and mints the Token-2022 prize to the buyer.

The on-chain lifecycle remains `buy_pull → settle_pull → claim_prize`. The API performs those instructions as separate transactions because the Light settle accounts and validity proof do not leave enough packet space for the Token-2022 mint flow.

## Local setup

From `games/gacha/pinocchio`:

```bash
pnpm install
just build-client
cp webapp/.env.example webapp/.env.local
just webapp-dev
```

Open `http://localhost:3000`. The standalone reveal preview is at `/simd-preview`.

## Configuration

| Variable                      | Visibility    | Purpose                                                         |
| ----------------------------- | ------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SOLANA_RPC_URL`  | Browser       | Browser-safe devnet RPC for reads and transaction preparation   |
| `NEXT_PUBLIC_POOL_ADMIN`      | Browser       | Optional featured-pool discovery hint                           |
| `NEXT_PUBLIC_DEFAULT_CLUSTER` | Browser       | Initial cluster selector value                                  |
| `SOLANA_RPC_URL`              | Server        | Photon-capable devnet endpoint used for cc-vrf and Light proofs |
| `GACHA_POOL_ADDRESS`          | Server        | The only pool accepted by `/api/pull`                           |
| `OPERATOR_KEYPAIR_BASE64`     | Server secret | Base64 encoding of the operator's 64-byte Solana keypair        |

Never prefix the operator key or server RPC with `NEXT_PUBLIC_`. On Vercel, store the operator key as a Sensitive Environment Variable and enable Fluid Compute. The API route uses the Node runtime with a five-minute maximum duration.

`OPERATOR_KEYPAIR_BASE64` expects the raw 64 keypair bytes rather than the JSON text. Convert the keypair JSON array to bytes before base64-encoding it, and never print the resulting value in logs.

## `POST /api/pull`

Request:

```json
{
    "buyer": "wallet address",
    "signedBuyTransaction": "base64 wire transaction"
}
```

The route is a strict relay. It accepts a versioned transaction with one wallet signer, allowlisted compute-budget instructions, and exactly one `buy_pull` targeting the configured pool. It rejects lookup tables, extra programs, unexpected accounts, stale pull PDAs, and unsigned transactions before broadcasting.

The route is retry-safe. It derives the transaction signature with Kit's base58 codec, checks transaction history, and resumes from the pull's on-chain Pending, Settled, or Claimed state. Retrying after a confirmed buy does not require another wallet approval.

## Routes

| Route           | Purpose                                                 |
| --------------- | ------------------------------------------------------- |
| `/`             | Buy, reveal, pull history, claim state, and refund      |
| `/verify`       | Reproduce alpha, tier selection, and ECVRF verification |
| `/admin`        | Create a pool and withdraw settled fees                 |
| `/simd-preview` | Wallet-free reveal animation preview                    |

Automated `/api/pull` processing is devnet-only. Other cluster selections retain the existing read, admin, verification, and manual transaction behavior.
