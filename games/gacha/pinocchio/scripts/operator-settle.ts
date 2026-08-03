/**
 * The reveal crank. Finds Pending pulls for a pool, produces each pull's ECVRF
 * `beta` with the operator's key, and submits `settle_pull` — which CPIs
 * cc-vrf's `commit_proof_with_beta` (anchoring the reveal in the Light registry)
 * and records the selected tier on-chain.
 *
 * The Light reveal context (validity proof, cc-vrf authority record, tree
 * accounts) is resolved by `@solana/gacha/reveal-context`, mirroring the tested
 * Rust settle path in `tests/light-integration-tests/tests/gacha_settle.rs`.
 *
 * Env:
 *   RPC_URL        Photon-capable devnet RPC (required). Falls back to VITE_DEVNET_RPC_URL
 *                  loaded from webapp/.env.local.
 *   ADMIN_KEYPAIR  admin keypair whose pool to crank (default ~/.config/solana/id.json).
 *                  Ignored when POOL is set.
 *   POOL           pool address to crank (overrides ADMIN_KEYPAIR derivation)
 *   POLL_MS        --watch poll interval in ms (default 5000)
 *
 * Run one-shot: `RPC_URL=… pnpm exec tsx scripts/operator-settle.ts`
 * Run watcher:  `RPC_URL=… pnpm exec tsx scripts/operator-settle.ts --watch`
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { gachaProgram, getPullDecoder, provePull, pullAlpha, RARITY_LABELS, selectTier } from '@solana/gacha';
import { buildSettleContext, fetchCommitBeta } from '@solana/gacha/reveal-context';
import {
    type Address,
    address,
    type Base58EncodedBytes,
    createClient,
    createKeyPairSignerFromBytes,
    getBase64Encoder,
    type KeyPairSigner,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';

import { loadWebappEnv } from './load-webapp-env.js';

loadWebappEnv();

const RPC_URL = process.env.RPC_URL ?? process.env.VITE_DEVNET_RPC_URL;
if (!RPC_URL) {
    throw new Error('Set RPC_URL or VITE_DEVNET_RPC_URL in webapp/.env.local to a Photon-capable endpoint');
}
const rpcUrl = RPC_URL;
const POLL_MS = Number(process.env.POLL_MS ?? '5000');
const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');

const GACHA_ID = 'Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS' as Address;

const PULL_STATUS_PENDING = 0;
const PULL_STATUS_SETTLED = 1;
const PULL_ACCOUNT_SIZE = 220n;
const PULL_POOL_OFFSET = 4n;

function loadKeypairBytes(path: string): Uint8Array {
    return Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

type Client = ReturnType<typeof createGachaClient>;

function createGachaClient(operatorSigner: KeyPairSigner) {
    return createClient().use(signer(operatorSigner)).use(solanaRpc({ rpcUrl })).use(gachaProgram());
}

async function resolvePoolAddress(client: Client, adminKeypairPath: string): Promise<Address> {
    if (process.env.POOL) return address(process.env.POOL);
    const admin = await createKeyPairSignerFromBytes(loadKeypairBytes(adminKeypairPath));
    const [pool] = await client.gacha.pdas.pool({ admin: admin.address });
    return pool;
}

async function settlePull(
    client: Client,
    operatorSigner: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
    poolWeights: number[],
    tierCount: number,
    authorityLabel: Uint8Array,
    pull: Address,
    pullClientSeed: Uint8Array,
    pullAlphaOnChain: Uint8Array,
): Promise<void> {
    const alpha = pullAlpha(pull, pullClientSeed);
    if (!bytesEqual(alpha, pullAlphaOnChain)) {
        throw new Error(`recomputed alpha mismatch for pull ${pull}`);
    }

    const { beta, proof } = provePull(operatorSeed, alpha);

    const context = await buildSettleContext(rpcUrl, { authorityLabel, operator: operatorSigner.address, pull });
    if (!context) throw new Error('operator authority not found in cc-vrf registry');
    if (!context.frozen) throw new Error('operator authority is not frozen');

    const settlePullData = { beta: Array.from(beta), light: context.light, proof: Array.from(proof) };
    const candidates =
        context.outputQueue === context.authorityQueue
            ? [context.outputQueue]
            : [context.outputQueue, context.authorityQueue];

    let lastErr: unknown;
    for (const outputQueue of candidates) {
        try {
            const { context: txContext } = await client.gacha.instructions
                .settlePull({
                    addressTree: context.addressTree,
                    authorityQueue: context.authorityQueue,
                    authorityStateTree: context.authorityStateTree,
                    operator: operatorSigner,
                    outputQueue,
                    pool,
                    pull,
                    settlePullData,
                })
                .sendTransaction();
            const tier = selectTier(beta, poolWeights, tierCount);
            console.log(`  ✓ settled ${pull} → tier ${tier} (${RARITY_LABELS[tier]})`);
            console.log(`    output_queue: ${outputQueue}`);
            console.log(`    tx: ${txContext.signature}`);
            await verifySettle(client, pull, context.authorityAddress, beta, tier);
            return;
        } catch (err) {
            lastErr = err;
            console.log(`    settle attempt with output_queue ${outputQueue} failed, trying fallback…`);
        }
    }
    throw lastErr;
}

async function verifySettle(
    client: Client,
    pull: Address,
    authorityAddress: Address,
    beta: Uint8Array,
    expectedTier: number,
): Promise<void> {
    const { data } = await client.gacha.accounts.pull.fetch(pull);
    if (data.status !== PULL_STATUS_SETTLED) throw new Error(`pull status is ${data.status}, expected Settled (1)`);
    if (data.tierSelected !== expectedTier) {
        throw new Error(`recorded tier ${data.tierSelected} != selectTier ${expectedTier}`);
    }
    if (!bytesEqual(Uint8Array.from(data.beta), beta)) throw new Error('recorded beta mismatch');

    const commitBeta = await fetchCommitBeta(rpcUrl, { authorityAddress, pull });
    if (!commitBeta) throw new Error('cc-vrf commit not found after settle');
    if (!bytesEqual(commitBeta, beta)) throw new Error('cc-vrf commit beta mismatch');
    console.log(`    verified: pull.tier == selectTier(beta) and cc-vrf commit anchored`);
}

async function crankOnce(
    client: Client,
    operatorSigner: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
): Promise<number> {
    const { data: poolData } = await client.gacha.accounts.pool.fetch(pool);
    if (poolData.operator !== operatorSigner.address) {
        throw new Error(`pool operator ${poolData.operator} != loaded operator ${operatorSigner.address}`);
    }
    const authorityLabel = Uint8Array.from(poolData.authorityLabel);
    const weights = poolData.weights.map(Number);
    const tierCount = poolData.tierCount;

    const accounts = await client.rpc
        .getProgramAccounts(GACHA_ID, {
            encoding: 'base64',
            filters: [
                { dataSize: PULL_ACCOUNT_SIZE },
                {
                    memcmp: {
                        bytes: pool as string as Base58EncodedBytes,
                        encoding: 'base58',
                        offset: PULL_POOL_OFFSET,
                    },
                },
            ],
        })
        .send();

    const base64Encoder = getBase64Encoder();
    const pending = accounts
        .map(({ account, pubkey }) => ({
            decoded: getPullDecoder().decode(base64Encoder.encode(account.data[0])),
            pubkey,
        }))
        .filter(({ decoded }) => decoded.status === PULL_STATUS_PENDING);

    if (pending.length === 0) return 0;

    for (const { decoded, pubkey } of pending) {
        try {
            await settlePull(
                client,
                operatorSigner,
                operatorSeed,
                pool,
                weights,
                tierCount,
                authorityLabel,
                pubkey,
                Uint8Array.from(decoded.clientSeed),
                Uint8Array.from(decoded.alpha),
            );
        } catch (err) {
            console.error(`  ✗ failed to settle ${pubkey}:`, err);
        }
    }
    return pending.length;
}

async function main(): Promise<void> {
    const watch = process.argv.includes('--watch');
    const operatorSecret = loadKeypairBytes(OPERATOR_KEYPAIR_PATH);
    const operatorSigner = await createKeyPairSignerFromBytes(operatorSecret);
    const operatorSeed = operatorSecret.slice(0, 32);

    const client = createGachaClient(operatorSigner);
    const pool = await resolvePoolAddress(client, process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`);

    console.log(`Operator: ${operatorSigner.address}`);
    console.log(`Pool:     ${pool}`);

    if (!watch) {
        const count = await crankOnce(client, operatorSigner, operatorSeed, pool);
        console.log(count === 0 ? 'No pending pulls.' : `Processed ${count} pending pull(s).`);
        return;
    }

    console.log(`Watching for pending pulls every ${POLL_MS}ms (Ctrl-C to stop)…`);
    for (;;) {
        try {
            await crankOnce(client, operatorSigner, operatorSeed, pool);
        } catch (err) {
            console.error('crank error:', err);
        }
        await new Promise(r => setTimeout(r, POLL_MS));
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
