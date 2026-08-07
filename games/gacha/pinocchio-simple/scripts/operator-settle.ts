/**
 * The reveal crank. Finds pending pulls for a pool (every pull account that
 * exists is pending — settling closes it), produces each pull's ECVRF `beta`
 * with the operator's key, and submits `settle_and_distribute` — which selects
 * the tier and mints the prize NFT (metadata carrying the full reveal
 * provenance) straight to the buyer.
 *
 * Env:
 *   RPC_URL        RPC endpoint (default https://api.devnet.solana.com)
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

import {
    GACHA_SIMPLE_PROGRAM_ADDRESS,
    gachaSimpleProgram,
    getPullDecoder,
    provePull,
    pullAlpha,
    RARITY_LABELS,
    selectTier,
} from '@solana/gacha-simple';
import {
    type Address,
    address,
    type Base58EncodedBytes,
    createClient,
    createKeyPairSignerFromBytes,
    getAddressEncoder,
    getBase64Encoder,
    getProgramDerivedAddress,
    type KeyPairSigner,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const POLL_MS = Number(process.env.POLL_MS ?? '5000');
const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;

/** `Pull` account layout: discriminator, bump, then the pool address. */
const PULL_ACCOUNT_SIZE = 146n;
const PULL_POOL_OFFSET = 2n;

function loadKeypairBytes(path: string): Uint8Array {
    return Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

type Client = ReturnType<typeof createGachaClient>;

function createGachaClient(operatorSigner: KeyPairSigner) {
    return createClient()
        .use(signer(operatorSigner))
        .use(solanaRpc({ rpcUrl: RPC_URL }))
        .use(gachaSimpleProgram());
}

async function findBuyerAta(buyer: Address, mint: Address): Promise<Address> {
    const encoder = getAddressEncoder();
    const [ata] = await getProgramDerivedAddress({
        programAddress: ATA_PROGRAM,
        seeds: [encoder.encode(buyer), encoder.encode(TOKEN_2022_PROGRAM), encoder.encode(mint)],
    });
    return ata;
}

async function resolvePoolAddress(client: Client, adminKeypairPath: string): Promise<Address> {
    if (process.env.POOL) return address(process.env.POOL);
    const admin = await createKeyPairSignerFromBytes(loadKeypairBytes(adminKeypairPath));
    const [pool] = await client.gachaSimple.pdas.pool({ admin: admin.address });
    return pool;
}

async function settlePull(
    client: Client,
    operatorSigner: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
    poolWeights: number[],
    tierCount: number,
    pull: Address,
    buyer: Address,
    pullClientSeed: Uint8Array,
    pullAlphaOnChain: Uint8Array,
): Promise<void> {
    const alpha = pullAlpha(pull, pullClientSeed);
    if (!bytesEqual(alpha, pullAlphaOnChain)) {
        throw new Error(`recomputed alpha mismatch for pull ${pull}`);
    }

    const { beta, proof } = provePull(operatorSeed, alpha);
    const [mint] = await client.gachaSimple.pdas.prizeMint({ pull });
    const buyerAta = await findBuyerAta(buyer, mint);

    const { context: txContext } = await client.gachaSimple.instructions
        .settleAndDistribute({
            buyer,
            buyerAta,
            operator: operatorSigner,
            pool,
            pull,
            settleAndDistributeData: { beta: Array.from(beta), proof: Array.from(proof) },
        })
        .sendTransaction();

    const tier = selectTier(beta, poolWeights, tierCount);
    console.log(`  ✓ settled ${pull} → tier ${tier} (${RARITY_LABELS[tier]})`);
    console.log(`    prize mint: ${mint}`);
    console.log(`    tx: ${txContext.signature}`);
}

async function crankOnce(
    client: Client,
    operatorSigner: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
): Promise<number> {
    const { data: poolData } = await client.gachaSimple.accounts.pool.fetch(pool);
    if (poolData.operator !== operatorSigner.address) {
        throw new Error(`pool operator ${poolData.operator} != loaded operator ${operatorSigner.address}`);
    }
    const weights = poolData.weights.map(Number);
    const tierCount = poolData.tierCount;

    const accounts = await client.rpc
        .getProgramAccounts(GACHA_SIMPLE_PROGRAM_ADDRESS, {
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
    const pending = accounts.map(({ account, pubkey }) => ({
        decoded: getPullDecoder().decode(base64Encoder.encode(account.data[0])),
        pubkey,
    }));

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
                pubkey,
                decoded.buyer,
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
