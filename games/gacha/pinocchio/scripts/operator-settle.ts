/**
 * The reveal crank. Finds Pending pulls for a pool, produces each pull's ECVRF
 * `beta` with the operator's key, and submits `settle_pull` — which CPIs
 * cc-vrf's `commit_proof_with_beta` (anchoring the reveal in the Light registry)
 * and records the selected tier on-chain.
 *
 * The 16-account order, the `LightCommitContext` field mapping, and the four
 * tree accounts mirror the tested Rust settle path in
 * `tests/light-integration-tests/tests/gacha_settle.rs` (`send_settle` /
 * `settle_ix`).
 *
 * Env:
 *   RPC_URL        Photon-capable devnet RPC (required). Falls back to VITE_DEVNET_RPC_URL.
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
    CC_VRF_PROGRAM_ID,
    deriveProofCommitWithBetaAddress,
    fetchAuthority,
    memoHash,
} from '@collectorcrypt/vrf-client';
import {
    buildCommitProofContext,
    fetchProofCommitWithBeta,
    forceLightV2,
    getProgram,
} from '@collectorcrypt/vrf-client';
import * as anchor from '@coral-xyz/anchor';
import { createRpc } from '@lightprotocol/stateless.js';
import {
    getPoolDecoder,
    getPullDecoder,
    getSettlePullDataEncoder,
    provePull,
    pullAlpha,
    RARITY_LABELS,
    selectTier,
} from '@solana/gacha';
import { type Address, getAddressEncoder, getProgramDerivedAddress, getUtf8Encoder } from '@solana/kit';
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL ?? process.env.VITE_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const POLL_MS = Number(process.env.POLL_MS ?? '5000');
const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');

const GACHA_ID = new PublicKey('Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS');
const CC_VRF_ID = new PublicKey('ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ');
const LIGHT_SYSTEM_PROGRAM_ID = new PublicKey('SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7');
const CC_VRF_CPI_AUTHORITY = new PublicKey('JEwC9hjj9yfWCQZQsMvy8zG92CcThefPxEp5T63UCFD');
const REGISTERED_PROGRAM_PDA = new PublicKey('35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh');
const ACCOUNT_COMPRESSION_AUTHORITY = new PublicKey('HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA');
const ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq');
const ADDRESS_TREE_V2 = new PublicKey('amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx');

const PULL_STATUS_PENDING = 0;
const PULL_ACCOUNT_SIZE = 220;
const PULL_POOL_OFFSET = 4;

type Program = ReturnType<typeof getProgram>;
type Rpc = ReturnType<typeof createRpc>;

function loadKeypair(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function findPoolAddress(): Promise<PublicKey> {
    if (process.env.POOL) return new PublicKey(process.env.POOL);
    const adminPath = process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const admin = loadKeypair(adminPath);
    const [pool] = await getProgramDerivedAddress({
        programAddress: GACHA_ID.toBase58() as Address,
        seeds: [getUtf8Encoder().encode('pool'), getAddressEncoder().encode(admin.publicKey.toBase58() as Address)],
    });
    return new PublicKey(pool);
}

async function findEventAuthority(): Promise<PublicKey> {
    const [eventAuthority] = await getProgramDerivedAddress({
        programAddress: GACHA_ID.toBase58() as Address,
        seeds: [getUtf8Encoder().encode('event_authority')],
    });
    return new PublicKey(eventAuthority);
}

function buildLightContext(
    proof0: { a: number[]; b: number[]; c: number[] },
    authorityAddress: PublicKey,
    authorityCreatedSlot: bigint,
    authorityMeta: { leafIndex: number; proveByIndex: boolean; rootIndex: number },
    addressTreeRootIndex: number,
) {
    const validityProof = [...proof0.a, ...proof0.b, ...proof0.c];
    if (validityProof.length !== 128) {
        throw new Error(`validity proof must be 128 bytes, got ${validityProof.length}`);
    }
    return {
        addressTreeRootIndex,
        authorityAddress: Array.from(authorityAddress.toBytes()),
        authorityCreatedSlot,
        authorityLeafIndex: authorityMeta.leafIndex,
        authorityProveByIndex: authorityMeta.proveByIndex ? 1 : 0,
        authorityRootIndex: authorityMeta.rootIndex,
        validityProof,
    };
}

function settleIx(
    operator: PublicKey,
    pool: PublicKey,
    pull: PublicKey,
    eventAuthority: PublicKey,
    trees: [PublicKey, PublicKey, PublicKey, PublicKey],
    data: Buffer,
): TransactionInstruction {
    return new TransactionInstruction({
        data,
        keys: [
            { isSigner: true, isWritable: true, pubkey: operator },
            { isSigner: false, isWritable: true, pubkey: pool },
            { isSigner: false, isWritable: true, pubkey: pull },
            { isSigner: false, isWritable: false, pubkey: CC_VRF_ID },
            { isSigner: false, isWritable: false, pubkey: LIGHT_SYSTEM_PROGRAM_ID },
            { isSigner: false, isWritable: false, pubkey: CC_VRF_CPI_AUTHORITY },
            { isSigner: false, isWritable: false, pubkey: REGISTERED_PROGRAM_PDA },
            { isSigner: false, isWritable: false, pubkey: ACCOUNT_COMPRESSION_AUTHORITY },
            { isSigner: false, isWritable: false, pubkey: ACCOUNT_COMPRESSION_PROGRAM_ID },
            { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
            { isSigner: false, isWritable: true, pubkey: trees[0] },
            { isSigner: false, isWritable: true, pubkey: trees[1] },
            { isSigner: false, isWritable: true, pubkey: trees[2] },
            { isSigner: false, isWritable: true, pubkey: trees[3] },
            { isSigner: false, isWritable: false, pubkey: eventAuthority },
            { isSigner: false, isWritable: false, pubkey: GACHA_ID },
        ],
        programId: GACHA_ID,
    });
}

async function settlePull(
    connection: Connection,
    program: Program,
    rpc: Rpc,
    operator: Keypair,
    pool: PublicKey,
    poolWeights: number[],
    tierCount: number,
    authorityLabel: Uint8Array,
    eventAuthority: PublicKey,
    pull: PublicKey,
    pullClientSeed: Uint8Array,
    pullAlphaOnChain: Uint8Array,
): Promise<void> {
    const seed = operator.secretKey.slice(0, 32);
    const alpha = pullAlpha(pull.toBase58() as Address, pullClientSeed);
    if (!bytesEqual(alpha, pullAlphaOnChain)) {
        throw new Error(`recomputed alpha mismatch for pull ${pull.toBase58()}`);
    }

    const { beta, proof } = provePull(seed, alpha);

    const memo = pull.toBytes();
    const memoHashBytes = memoHash(memo);

    const authority = await fetchAuthority(program, rpc, operator.publicKey, authorityLabel);
    if (!authority) throw new Error('operator authority not found in cc-vrf registry');
    if (!authority.decoded.frozen) throw new Error('operator authority is not frozen');

    const commitAddr = deriveProofCommitWithBetaAddress(authority.authorityAddress, memoHashBytes, CC_VRF_PROGRAM_ID);
    const ctx = await buildCommitProofContext(rpc, CC_VRF_PROGRAM_ID, authority.account, commitAddr);

    const proof0 = ctx.proof[0];
    if (!proof0) throw new Error('settle requires a validity proof');

    // The packed indices are relative to the tree slice of `remainingAccountMetas`,
    // which sits after the Light system-account prefix. Recover the prefix length
    // from the highest packed index so `treeBase + index` resolves the pubkey.
    const metas = ctx.remainingAccountMetas;
    const mtIndex = ctx.authorityReadOnlyMeta.treeInfo.merkleTreePubkeyIndex;
    const queueIndex = ctx.authorityReadOnlyMeta.treeInfo.queuePubkeyIndex;
    const addressIndex = ctx.packedAddressTreeInfo.addressMerkleTreePubkeyIndex;
    const outputIndex = ctx.outputStateTreeIndex;
    const treeBase = metas.length - (Math.max(mtIndex, queueIndex, addressIndex, outputIndex) + 1);

    const authorityTree = metas[treeBase + mtIndex].pubkey;
    const authorityQueue = metas[treeBase + queueIndex].pubkey;
    const addressTree = metas[treeBase + addressIndex].pubkey;
    const outputQueue = metas[treeBase + outputIndex].pubkey;
    if (!addressTree.equals(ADDRESS_TREE_V2)) {
        throw new Error(`address tree mismatch: ${addressTree.toBase58()} != ${ADDRESS_TREE_V2.toBase58()}`);
    }

    const light = buildLightContext(
        proof0,
        authority.authorityAddress,
        BigInt(String(authority.decoded.createdSlot)),
        ctx.authorityReadOnlyMeta.treeInfo,
        ctx.packedAddressTreeInfo.rootIndex,
    );

    const data = Buffer.concat([
        Buffer.from([2]),
        Buffer.from(getSettlePullDataEncoder().encode({ beta: Array.from(beta), light, proof: Array.from(proof) })),
    ]);

    const computeBudget = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
    const outputQueueCandidates = outputQueue.equals(authorityQueue) ? [outputQueue] : [outputQueue, authorityQueue];

    let lastErr: unknown;
    for (const candidate of outputQueueCandidates) {
        const ix = settleIx(
            operator.publicKey,
            pool,
            pull,
            eventAuthority,
            [authorityTree, authorityQueue, addressTree, candidate],
            data,
        );
        try {
            const sig = await sendAndConfirmTransaction(
                connection,
                new Transaction().add(computeBudget, ix),
                [operator],
                {
                    commitment: 'confirmed',
                },
            );
            const tier = selectTier(beta, poolWeights, tierCount);
            console.log(`  ✓ settled ${pull.toBase58()} → tier ${tier} (${RARITY_LABELS[tier]})`);
            console.log(`    output_queue: ${candidate.toBase58()}`);
            console.log(`    tx: ${sig}`);
            await verifySettle(connection, program, rpc, pull, authority.authorityAddress, memo, beta, tier);
            return;
        } catch (err) {
            lastErr = err;
            console.log(`    settle attempt with output_queue ${candidate.toBase58()} failed, trying fallback…`);
        }
    }
    throw lastErr;
}

async function verifySettle(
    connection: Connection,
    program: Program,
    rpc: Rpc,
    pull: PublicKey,
    authorityAddress: PublicKey,
    memo: Uint8Array,
    beta: Uint8Array,
    expectedTier: number,
): Promise<void> {
    const info = await connection.getAccountInfo(pull, 'confirmed');
    if (!info) throw new Error('pull account vanished after settle');
    const decoded = getPullDecoder().decode(new Uint8Array(info.data));
    if (decoded.status !== 1) throw new Error(`pull status is ${decoded.status}, expected Settled (1)`);
    if (decoded.tierSelected !== expectedTier) {
        throw new Error(`recorded tier ${decoded.tierSelected} != selectTier ${expectedTier}`);
    }
    if (!bytesEqual(Uint8Array.from(decoded.beta), beta)) throw new Error('recorded beta mismatch');

    const commit = await fetchProofCommitWithBeta(program, rpc, authorityAddress, memo);
    if (!commit) throw new Error('cc-vrf commit not found after settle');
    if (!bytesEqual(commit.beta, beta)) throw new Error('cc-vrf commit beta mismatch');
    console.log(`    verified: pull.tier == selectTier(beta) and cc-vrf commit anchored`);
}

async function crankOnce(
    connection: Connection,
    program: Program,
    rpc: Rpc,
    operator: Keypair,
    pool: PublicKey,
    eventAuthority: PublicKey,
): Promise<number> {
    const info = await connection.getAccountInfo(pool, 'confirmed');
    if (!info) throw new Error(`pool ${pool.toBase58()} not found`);
    const poolDecoded = getPoolDecoder().decode(new Uint8Array(info.data));
    if (poolDecoded.operator !== operator.publicKey.toBase58()) {
        throw new Error(`pool operator ${poolDecoded.operator} != loaded operator ${operator.publicKey.toBase58()}`);
    }
    const authorityLabel = Uint8Array.from(poolDecoded.authorityLabel);
    const weights = poolDecoded.weights.map(Number);
    const tierCount = poolDecoded.tierCount;

    const accounts = await connection.getProgramAccounts(GACHA_ID, {
        filters: [{ dataSize: PULL_ACCOUNT_SIZE }, { memcmp: { bytes: pool.toBase58(), offset: PULL_POOL_OFFSET } }],
    });

    const pending = accounts
        .map(({ account, pubkey }) => ({ decoded: getPullDecoder().decode(new Uint8Array(account.data)), pubkey }))
        .filter(({ decoded }) => decoded.status === PULL_STATUS_PENDING);

    if (pending.length === 0) return 0;

    for (const { decoded, pubkey } of pending) {
        try {
            await settlePull(
                connection,
                program,
                rpc,
                operator,
                pool,
                weights,
                tierCount,
                authorityLabel,
                eventAuthority,
                pubkey,
                Uint8Array.from(decoded.clientSeed),
                Uint8Array.from(decoded.alpha),
            );
        } catch (err) {
            console.error(`  ✗ failed to settle ${pubkey.toBase58()}:`, err);
        }
    }
    return pending.length;
}

async function main(): Promise<void> {
    const watch = process.argv.includes('--watch');
    const operator = loadKeypair(OPERATOR_KEYPAIR_PATH);
    const pool = await findPoolAddress();

    const connection = new Connection(RPC_URL, 'confirmed');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), { commitment: 'confirmed' });
    const program = getProgram(provider);
    const rpc = createRpc(RPC_URL, RPC_URL, RPC_URL);
    forceLightV2();
    const eventAuthority = await findEventAuthority();

    console.log(`Operator: ${operator.publicKey.toBase58()}`);
    console.log(`Pool:     ${pool.toBase58()}`);

    if (!watch) {
        const count = await crankOnce(connection, program, rpc, operator, pool, eventAuthority);
        console.log(count === 0 ? 'No pending pulls.' : `Processed ${count} pending pull(s).`);
        return;
    }

    console.log(`Watching for pending pulls every ${POLL_MS}ms (Ctrl-C to stop)…`);
    for (;;) {
        try {
            await crankOnce(connection, program, rpc, operator, pool, eventAuthority);
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
