/**
 * Devnet burst test for the reveal path: opens and settles many pulls against a
 * dedicated low-fee pool, re-derives every reveal off-chain, and scores the tier
 * distribution against the pool's fixed weights.
 *
 * Per-pull invariants (any failure fails the run):
 *   - on-chain `alpha` == `SHA-256(pull || client_seed)`
 *   - on-chain `beta` == the operator's ECVRF output for that `alpha`, recomputed
 *     locally; reveals produced by this run also verify their 80-byte proof
 *   - on-chain `tier_selected` == `selectTier(beta, weights, tierCount)`
 *   - every `beta` is distinct
 *
 * Distribution tests over the collected betas, each rejected at α = 0.001:
 *   - tier counts vs the pool weights (chi-square, df = tierCount - 1)
 *   - beta bit balance (monobit)
 *   - beta byte uniformity (chi-square, df = 255)
 *
 * The burst pool is separate from the demo pool: a throwaway admin keypair in
 * `keys/burst-admin-keypair.json` owns it and each pull costs 1 lamport, so a run
 * accrues no revenue worth withdrawing. The real cost is pull rent (~0.0024 SOL
 * per pull), which only comes back for pulls that stay pending — `refund_pull`
 * after the deadline. Settled pulls keep their rent, so a 200-pull run spends
 * about 0.5 devnet SOL permanently.
 *
 * `--analyze` skips buying and settling and reports over every pull the burst
 * pool has ever recorded, so samples accumulate across runs at no cost.
 *
 * Env:
 *   RPC_URL         Photon-capable devnet RPC (required). Falls back to
 *                   VITE_DEVNET_RPC_URL / SOLANA_RPC_URL from webapp/.env.local.
 *   PULLS           pulls to open and settle (default 100)
 *   CONCURRENCY     settles in flight (default 4)
 *   BUY_BATCH       buys packed per transaction, 1–8 (default 8)
 *   PAYER_KEYPAIR   buyer + funding keypair (default ~/.config/solana/id.json)
 *   WEIGHTS         tier weights used only when creating the pool
 *                   (default "1,1,1,1,1,1,1,1" — equal odds maximize the power
 *                   of the chi-square test at a few hundred samples)
 *   LABEL           cc-vrf authority label of the operator (default "gacha-demo")
 *   ENTRY_FEE_LAMPORTS  entry fee when creating the pool (default 1)
 *   DEADLINE_SLOTS  refund deadline when creating the pool (default 300)
 *
 * Run: `RPC_URL=… PULLS=200 pnpm exec tsx scripts/burst-randomness.ts`
 * Report only: `RPC_URL=… pnpm exec tsx scripts/burst-randomness.ts --analyze`
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
    findPullPda,
    GACHA_PROGRAM_ADDRESS,
    gachaProgram,
    getPullDecoder,
    MAX_TIERS,
    provePull,
    publicKeyFromSeed,
    type Pull,
    pullAlpha,
    RARITY_LABELS,
    selectTier,
    verifyPull,
} from '@solana/gacha';
import { buildSettleContext } from '@solana/gacha/reveal-context';
import {
    AccountRole,
    type Address,
    type Base58EncodedBytes,
    createClient,
    createKeyPairSignerFromBytes,
    getAddressEncoder,
    getBase64Encoder,
    getU32Encoder,
    getU64Encoder,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';

import { loadWebappEnv } from './load-webapp-env.js';

loadWebappEnv();

const RPC_URL = process.env.RPC_URL ?? process.env.VITE_DEVNET_RPC_URL ?? process.env.SOLANA_RPC_URL;
if (!RPC_URL) {
    throw new Error('Set RPC_URL (or VITE_DEVNET_RPC_URL / SOLANA_RPC_URL in webapp/.env.local)');
}
const rpcUrl = RPC_URL;

const ANALYZE_ONLY = process.argv.includes('--analyze');
const PULLS = Math.max(1, Math.floor(Number(process.env.PULLS ?? '100')));
const CONCURRENCY = Math.max(1, Math.floor(Number(process.env.CONCURRENCY ?? '4')));
/** Buys per transaction; 8 `buy_pull` instructions still fit the 1232-byte limit. */
const BUY_BATCH = Math.min(8, Math.max(1, Math.floor(Number(process.env.BUY_BATCH ?? '8'))));

const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');
const BURST_ADMIN_KEYPAIR_PATH = resolve(process.cwd(), 'keys/burst-admin-keypair.json');

const LAMPORTS_PER_SOL = 1_000_000_000n;
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111' as Address;
/** System program instruction index for `Transfer`. */
const SYSTEM_TRANSFER_INSTRUCTION = 2;
/** Rent for the pool + vault accounts the burst admin creates, plus its fees. */
const POOL_SETUP_LAMPORTS = 20_000_000n;
/** Signature fee assumed per buy transaction. */
const BUY_FEE_LAMPORTS = 5_000n;
/** Signature fee plus Light state/address-queue fees assumed per settle. */
const SETTLE_COST_LAMPORTS = 20_000n;

const PULL_ACCOUNT_SIZE = 220n;
const PULL_POOL_OFFSET = 4n;
const PULL_STATUS_PENDING = 0;

const SETTLE_ATTEMPTS = 3;
const MAX_BUY_FAILURES = 5;
/** Significance level at which a distribution test is reported as a failure. */
const SIGNIFICANCE_LEVEL = 0.001;
/** Chi-square is unreliable when an expected bucket count falls below this. */
const MIN_EXPECTED_COUNT = 5;

const u32 = (value: number): Uint8Array => Uint8Array.from(getU32Encoder().encode(value));
const u64 = (value: bigint): Uint8Array => Uint8Array.from(getU64Encoder().encode(value));

function loadKeypairBytes(path: string): Uint8Array {
    return Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function toHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex');
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function sol(lamports: bigint): string {
    return (Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4);
}

function labelBytes(label: string): number[] {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode(label).slice(0, 32));
    return Array.from(bytes);
}

function sleep(ms: number): Promise<void> {
    return new Promise(done => setTimeout(done, ms));
}

// ============================================
// Statistics
// ============================================

/** Complementary error function, Numerical Recipes `erfcc` (fractional error < 1.2e-7). */
function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 1 / (1 + z / 2);
    const poly =
        -1.26551223 +
        t *
            (1.00002368 +
                t *
                    (0.37409196 +
                        t *
                            (0.09678418 +
                                t *
                                    (-0.18628806 +
                                        t *
                                            (0.27886807 +
                                                t *
                                                    (-1.13520398 +
                                                        t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
    const y = t * Math.exp(-z * z + poly);
    return x >= 0 ? y : 2 - y;
}

/**
 * Upper-tail probability `P(χ²_df > x)` — the p-value of a chi-square statistic.
 *
 * Built from the closed forms `Q(x, 1) = erfc(√(x/2))` and `Q(x, 2) = e^(-x/2)`
 * and the step-of-two recurrence `Q(x, df + 2) = Q(x, df) + (x/2)^(df/2)·e^(-x/2)/Γ(df/2 + 1)`,
 * so it is exact for every integer df without an incomplete-gamma routine.
 */
function chiSquarePValue(x: number, df: number): number {
    if (!(x > 0)) return 1;
    const half = x / 2;
    const odd = df % 2 === 1;
    let q = odd ? erfc(Math.sqrt(half)) : Math.exp(-half);
    let term = odd ? Math.exp(-half) * Math.sqrt((2 * x) / Math.PI) : half * Math.exp(-half);
    for (let k = odd ? 1 : 2; k + 2 <= df; k += 2) {
        q += term;
        term *= half / (k / 2 + 1);
    }
    return Math.min(1, Math.max(0, q));
}

interface ChiSquareResult {
    df: number;
    pValue: number;
    statistic: number;
}

function chiSquare(observed: readonly number[], expected: readonly number[]): ChiSquareResult {
    let statistic = 0;
    for (let i = 0; i < observed.length; i++) {
        const e = expected[i] ?? 0;
        if (e <= 0) continue;
        const diff = (observed[i] ?? 0) - e;
        statistic += (diff * diff) / e;
    }
    const df = observed.length - 1;
    return { df, pValue: chiSquarePValue(statistic, df), statistic };
}

/** Two-sided p-value for the proportion of set bits in a sequence. */
function monobit(onesCount: number, bitCount: number): { pValue: number; z: number } {
    const z = (onesCount - bitCount / 2) / (Math.sqrt(bitCount) / 2);
    return { pValue: erfc(Math.abs(z) / Math.SQRT2), z };
}

// ============================================
// Keys, pool, funding
// ============================================

/** Loads the throwaway pool admin, generating it on first run. */
async function loadOrCreateBurstAdmin(): Promise<KeyPairSigner> {
    if (!existsSync(BURST_ADMIN_KEYPAIR_PATH)) {
        const seed = new Uint8Array(randomBytes(32));
        const secretKey = new Uint8Array(64);
        secretKey.set(seed, 0);
        secretKey.set(publicKeyFromSeed(seed), 32);
        mkdirSync(dirname(BURST_ADMIN_KEYPAIR_PATH), { recursive: true });
        writeFileSync(BURST_ADMIN_KEYPAIR_PATH, JSON.stringify(Array.from(secretKey)));
    }
    return await createKeyPairSignerFromBytes(loadKeypairBytes(BURST_ADMIN_KEYPAIR_PATH));
}

type Client = ReturnType<typeof createGachaClient>;

function createGachaClient(payer: KeyPairSigner) {
    return createClient().use(signer(payer)).use(solanaRpc({ rpcUrl })).use(gachaProgram());
}

function transferInstruction(from: KeyPairSigner, to: Address, lamports: bigint): Instruction {
    const data = new Uint8Array(12);
    data.set(u32(SYSTEM_TRANSFER_INSTRUCTION), 0);
    data.set(u64(lamports), 4);
    return {
        accounts: [
            { address: from.address, role: AccountRole.WRITABLE_SIGNER },
            { address: to, role: AccountRole.WRITABLE },
        ],
        data,
        programAddress: SYSTEM_PROGRAM_ADDRESS,
    };
}

/** Tops `target` up to `required` lamports from the payer, and reports what it sent. */
async function fundIfBelow(client: Client, payer: KeyPairSigner, target: Address, required: bigint): Promise<void> {
    const { value: balance } = await client.rpc.getBalance(target).send();
    if (balance >= required) return;
    const lamports = required - balance;
    const { context } = await client.sendTransaction([transferInstruction(payer, target, lamports)]);
    console.log(`  funded ${target} with ${sol(lamports)} SOL (${context.signature})`);
}

/** Creates the burst pool on first run; later runs reuse it and its recorded weights. */
async function ensureBurstPool(client: Client, payer: KeyPairSigner, operator: Address): Promise<Address> {
    const burstAdmin = await loadOrCreateBurstAdmin();
    const [pool] = await client.gacha.pdas.pool({ admin: burstAdmin.address });

    const existing = await client.gacha.accounts.pool.fetchMaybe(pool);
    if (existing.exists) return pool;
    if (ANALYZE_ONLY) throw new Error(`burst pool ${pool} does not exist yet — run without --analyze first`);

    const weights = (process.env.WEIGHTS ?? '1,1,1,1,1,1,1,1')
        .split(',')
        .map(w => Number(w.trim()))
        .filter(w => Number.isFinite(w) && w > 0);
    if (weights.length === 0 || weights.length > MAX_TIERS) {
        throw new Error(`WEIGHTS must list 1–${MAX_TIERS} positive numbers`);
    }

    await fundIfBelow(client, payer, burstAdmin.address, POOL_SETUP_LAMPORTS);

    const adminClient = createGachaClient(burstAdmin);
    const { context } = await adminClient.gacha.instructions
        .initPool({
            admin: burstAdmin,
            initPoolData: {
                authorityLabel: labelBytes(process.env.LABEL ?? 'gacha-demo'),
                entryFee: BigInt(process.env.ENTRY_FEE_LAMPORTS ?? '1'),
                operator,
                settleDeadlineSlots: BigInt(process.env.DEADLINE_SLOTS ?? '300'),
                tierCount: weights.length,
                weights: [...weights, ...Array<number>(MAX_TIERS - weights.length).fill(0)],
            },
        })
        .sendTransaction();
    console.log(`  created burst pool ${pool} (${context.signature})`);
    return pool;
}

// ============================================
// Buy and settle
// ============================================

interface BoughtPull {
    clientSeed: Uint8Array;
    pull: Address;
}

/**
 * Opens `count` pulls, packing `BUY_BATCH` of them per transaction.
 *
 * `buy_pull` takes the pull index from `pool.pulls_count` and requires the pull
 * PDA to match, so batched buys must claim consecutive indices in the order the
 * instructions execute. A failed batch claims none of them, so any failure
 * re-reads the counter before continuing.
 */
async function buyPulls(client: Client, buyer: KeyPairSigner, pool: Address, count: number): Promise<BoughtPull[]> {
    const { data: poolData } = await client.gacha.accounts.pool.fetch(pool);
    const [vault] = await client.gacha.pdas.vault({ admin: poolData.admin });

    const bought: BoughtPull[] = [];
    let index = poolData.pullsCount;
    let failures = 0;

    while (bought.length < count) {
        const batch: BoughtPull[] = [];
        const instructions: Instruction[] = [];
        for (let offset = 0; offset < Math.min(BUY_BATCH, count - bought.length); offset++) {
            const clientSeed = new Uint8Array(randomBytes(32));
            const [pull] = await findPullPda({ buyer: buyer.address, index: index + BigInt(offset), pool });
            batch.push({ clientSeed, pull });
            instructions.push(
                await client.gacha.instructions.buyPull({
                    buyPullData: { clientSeed: Array.from(clientSeed) },
                    buyer,
                    pool,
                    pull,
                    vault,
                }),
            );
        }

        try {
            await client.sendTransaction(instructions);
            bought.push(...batch);
            index += BigInt(batch.length);
            console.log(`  bought ${bought.length}/${count}`);
        } catch (err) {
            failures += 1;
            if (failures > MAX_BUY_FAILURES) throw err;
            console.error(`  ✗ buy batch at index ${index} failed: ${errorMessage(err)}`);
            const { data } = await client.gacha.accounts.pool.fetch(pool);
            index = data.pullsCount;
        }
    }
    return bought;
}

interface Reveal {
    beta: Uint8Array;
    proof: Uint8Array;
}

/**
 * Reveals one pull. The context is rebuilt per attempt because a validity proof
 * is only good against the tree roots it was fetched for, and concurrent settles
 * move those roots; the output-queue fallback mirrors `scripts/operator-settle.ts`.
 */
async function settleOne(
    client: Client,
    operator: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
    authorityLabel: Uint8Array,
    bought: BoughtPull,
): Promise<Reveal> {
    const alpha = pullAlpha(bought.pull, bought.clientSeed);
    const { beta, proof } = provePull(operatorSeed, alpha);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
        const context = await buildSettleContext(rpcUrl, {
            authorityLabel,
            operator: operator.address,
            pull: bought.pull,
        });
        if (!context) throw new Error('operator authority not found in cc-vrf registry');
        if (!context.frozen) throw new Error('operator authority is not frozen');

        const queues =
            context.outputQueue === context.authorityQueue
                ? [context.outputQueue]
                : [context.outputQueue, context.authorityQueue];
        for (const outputQueue of queues) {
            try {
                await client.gacha.instructions
                    .settlePull({
                        addressTree: context.addressTree,
                        authorityQueue: context.authorityQueue,
                        authorityStateTree: context.authorityStateTree,
                        operator,
                        outputQueue,
                        pool,
                        pull: bought.pull,
                        settlePullData: { beta: Array.from(beta), light: context.light, proof: Array.from(proof) },
                    })
                    .sendTransaction();
                return { beta, proof };
            } catch (err) {
                lastErr = err;
            }
        }
        await sleep(500 * attempt);
    }
    throw new Error(`settle failed after ${SETTLE_ATTEMPTS} attempts: ${errorMessage(lastErr)}`, { cause: lastErr });
}

/** Settles every bought pull, keeping `CONCURRENCY` reveals in flight. */
async function settlePulls(
    client: Client,
    operator: KeyPairSigner,
    operatorSeed: Uint8Array,
    pool: Address,
    authorityLabel: Uint8Array,
    bought: readonly BoughtPull[],
): Promise<Map<Address, Reveal>> {
    const queue = [...bought];
    const total = queue.length;
    const reveals = new Map<Address, Reveal>();
    let done = 0;

    const worker = async (): Promise<void> => {
        for (;;) {
            const next = queue.shift();
            if (!next) return;
            try {
                reveals.set(next.pull, await settleOne(client, operator, operatorSeed, pool, authorityLabel, next));
            } catch (err) {
                console.error(`  ✗ settle ${next.pull} failed: ${errorMessage(err)}`);
            }
            done += 1;
            if (done % 25 === 0 || done === total) console.log(`  settled ${reveals.size}/${done} of ${total}`);
        }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    return reveals;
}

// ============================================
// Verification and report
// ============================================

interface OnChainPull {
    address: Address;
    data: Pull;
}

async function fetchPoolPulls(client: Client, pool: Address): Promise<OnChainPull[]> {
    const accounts = await client.rpc
        .getProgramAccounts(GACHA_PROGRAM_ADDRESS, {
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
    return accounts.map(({ account, pubkey }) => ({
        address: pubkey,
        data: getPullDecoder().decode(base64Encoder.encode(account.data[0])),
    }));
}

interface Verification {
    betas: Uint8Array[];
    failures: string[];
    pending: number;
    proofsVerified: number;
    tierCounts: number[];
}

/**
 * Re-derives every settled pull from its stored `client_seed`: the VRF input, the
 * operator's ECVRF output for it, and the tier that output selects. `beta` is
 * recomputed rather than trusted, so a run also re-verifies pulls settled by
 * earlier runs (whose 80-byte proofs are not stored on-chain).
 */
function verifyPulls(
    pulls: readonly OnChainPull[],
    reveals: Map<Address, Reveal>,
    operatorSeed: Uint8Array,
    operatorPublicKey: Uint8Array,
    weights: readonly number[],
    tierCount: number,
): Verification {
    const result: Verification = {
        betas: [],
        failures: [],
        pending: 0,
        proofsVerified: 0,
        tierCounts: Array<number>(tierCount).fill(0),
    };
    const seen = new Map<string, Address>();

    for (const { address, data } of pulls) {
        if (data.status === PULL_STATUS_PENDING) {
            result.pending += 1;
            continue;
        }

        const clientSeed = Uint8Array.from(data.clientSeed);
        const alpha = Uint8Array.from(data.alpha);
        const beta = Uint8Array.from(data.beta);

        if (!bytesEqual(pullAlpha(address, clientSeed), alpha)) {
            result.failures.push(`${address}: alpha != SHA-256(pull || client_seed)`);
            continue;
        }
        if (!bytesEqual(provePull(operatorSeed, alpha).beta, beta)) {
            result.failures.push(`${address}: beta is not the operator's ECVRF output for alpha`);
            continue;
        }
        const expectedTier = selectTier(beta, weights, tierCount);
        if (data.tierSelected !== expectedTier) {
            result.failures.push(`${address}: tier ${data.tierSelected} != selectTier ${expectedTier}`);
            continue;
        }
        const duplicate = seen.get(toHex(beta));
        if (duplicate) {
            result.failures.push(`${address}: beta collides with ${duplicate}`);
            continue;
        }

        const reveal = reveals.get(address);
        if (reveal) {
            if (!verifyPull(operatorPublicKey, alpha, reveal.proof)) {
                result.failures.push(`${address}: ECVRF proof does not verify`);
                continue;
            }
            result.proofsVerified += 1;
        }

        seen.set(toHex(beta), address);
        result.betas.push(beta);
        result.tierCounts[expectedTier] = (result.tierCounts[expectedTier] ?? 0) + 1;
    }
    return result;
}

function verdict(pValue: number): string {
    return pValue < SIGNIFICANCE_LEVEL ? 'FAIL' : 'pass';
}

/** Prints the distribution report and returns whether every test passed. */
function report(verification: Verification, weights: readonly number[], tierCount: number): boolean {
    const samples = verification.betas.length;
    const totalWeight = weights.slice(0, tierCount).reduce((sum, w) => sum + w, 0);
    const expected = weights.slice(0, tierCount).map(w => (samples * w) / totalWeight);

    console.log(`\nSamples: ${samples} settled, ${verification.pending} pending`);
    console.log(`Weights: ${weights.slice(0, tierCount).join('/')} (total ${totalWeight})`);
    console.log('\n  tier  label       observed  expected   deviation');
    for (let tier = 0; tier < tierCount; tier++) {
        const observed = verification.tierCounts[tier] ?? 0;
        const e = expected[tier] ?? 0;
        const deviation = e > 0 ? `${(((observed - e) / e) * 100).toFixed(1)}%` : 'n/a';
        const label = RARITY_LABELS[tier] ?? `tier ${tier}`;
        console.log(
            `  ${String(tier).padEnd(4)}  ${label.padEnd(10)}  ${String(observed).padStart(8)}  ${e.toFixed(1).padStart(8)}  ${deviation.padStart(10)}`,
        );
    }

    const tiers = chiSquare(verification.tierCounts, expected);
    console.log(
        `\n  tier distribution:   χ² = ${tiers.statistic.toFixed(2)}  df = ${tiers.df}  p = ${tiers.pValue.toFixed(4)}  → ${verdict(tiers.pValue)}`,
    );
    if (Math.min(...expected) < MIN_EXPECTED_COUNT) {
        console.log(
            `  ⚠ smallest expected count is ${Math.min(...expected).toFixed(1)} (< ${MIN_EXPECTED_COUNT}) — raise PULLS or flatten WEIGHTS for a reliable χ²`,
        );
    }

    let ones = 0;
    const byteCounts = Array<number>(256).fill(0);
    for (const beta of verification.betas) {
        for (const byte of beta) {
            byteCounts[byte] = (byteCounts[byte] ?? 0) + 1;
            for (let bit = 0; bit < 8; bit++) ones += (byte >> bit) & 1;
        }
    }
    const bits = samples * 64 * 8;
    const bitBalance = monobit(ones, bits);
    const bytes = chiSquare(byteCounts, Array<number>(256).fill((samples * 64) / 256));
    console.log(
        `  beta bit balance:    ${ones} of ${bits} bits set (${((100 * ones) / bits).toFixed(2)}%)  z = ${bitBalance.z.toFixed(2)}  p = ${bitBalance.pValue.toFixed(4)}  → ${verdict(bitBalance.pValue)}`,
    );
    console.log(
        `  beta byte uniformity: χ² = ${bytes.statistic.toFixed(2)}  df = ${bytes.df}  p = ${bytes.pValue.toFixed(4)}  → ${verdict(bytes.pValue)}`,
    );
    console.log(`  proofs verified:     ${verification.proofsVerified} (this run's reveals)`);

    if (verification.failures.length > 0) {
        console.log(`\n✗ ${verification.failures.length} pull(s) failed verification:`);
        for (const failure of verification.failures.slice(0, 10)) console.log(`    ${failure}`);
        if (verification.failures.length > 10) console.log(`    … ${verification.failures.length - 10} more`);
    }

    return (
        verification.failures.length === 0 &&
        tiers.pValue >= SIGNIFICANCE_LEVEL &&
        bitBalance.pValue >= SIGNIFICANCE_LEVEL &&
        bytes.pValue >= SIGNIFICANCE_LEVEL
    );
}

// ============================================

async function main(): Promise<void> {
    if (!existsSync(OPERATOR_KEYPAIR_PATH)) {
        throw new Error(`${OPERATOR_KEYPAIR_PATH} not found — run \`just register-operator\` first`);
    }
    const operatorSecret = loadKeypairBytes(OPERATOR_KEYPAIR_PATH);
    const operator = await createKeyPairSignerFromBytes(operatorSecret);
    const operatorSeed = operatorSecret.slice(0, 32);
    const operatorPublicKey = Uint8Array.from(getAddressEncoder().encode(operator.address));

    const payerPath = process.env.PAYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const payer = await createKeyPairSignerFromBytes(loadKeypairBytes(payerPath));
    const client = createGachaClient(payer);

    const pool = await ensureBurstPool(client, payer, operator.address);
    const { data: poolData } = await client.gacha.accounts.pool.fetch(pool);
    if (poolData.operator !== operator.address) {
        throw new Error(`burst pool operator ${poolData.operator} != loaded operator ${operator.address}`);
    }
    const weights = poolData.weights.map(Number);
    const tierCount = poolData.tierCount;
    const authorityLabel = Uint8Array.from(poolData.authorityLabel);

    console.log(`Pool:     ${pool}`);
    console.log(`Buyer:    ${payer.address}`);
    console.log(`Operator: ${operator.address}`);
    console.log(`Entry fee: ${poolData.entryFee} lamports`);

    let reveals = new Map<Address, Reveal>();
    if (!ANALYZE_ONLY) {
        const pullRent = await client.rpc.getMinimumBalanceForRentExemption(PULL_ACCOUNT_SIZE).send();
        const buyerCost =
            BigInt(PULLS) * (pullRent + poolData.entryFee) + BigInt(Math.ceil(PULLS / BUY_BATCH)) * BUY_FEE_LAMPORTS;
        const operatorCost = BigInt(PULLS) * SETTLE_COST_LAMPORTS;
        console.log(
            `\n${PULLS} pulls ≈ ${sol(buyerCost)} SOL from the buyer (${sol(BigInt(PULLS) * pullRent)} of it pull rent, ` +
                `unrecoverable once settled) + ${sol(operatorCost)} SOL of operator fees`,
        );

        const { value: payerBalance } = await client.rpc.getBalance(payer.address).send();
        if (payerBalance < buyerCost + operatorCost) {
            throw new Error(
                `buyer balance ${sol(payerBalance)} SOL is below the ${sol(buyerCost + operatorCost)} SOL this run needs`,
            );
        }
        await fundIfBelow(client, payer, operator.address, operatorCost);

        console.log(`\nOpening ${PULLS} pulls (${BUY_BATCH} per transaction)…`);
        const bought = await buyPulls(client, payer, pool, PULLS);
        console.log(`\nRevealing ${bought.length} pulls (${CONCURRENCY} in flight)…`);
        reveals = await settlePulls(client, operator, operatorSeed, pool, authorityLabel, bought);
    }

    const pulls = await fetchPoolPulls(client, pool);
    const verification = verifyPulls(pulls, reveals, operatorSeed, operatorPublicKey, weights, tierCount);
    if (verification.betas.length === 0) throw new Error('no settled pulls to analyze');

    const passed = report(verification, weights, tierCount);
    console.log(passed ? '\n✓ PASS' : '\n✗ FAIL');
    if (!passed) process.exitCode = 1;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
