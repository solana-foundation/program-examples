/**
 * Creates a gacha pool with `init_pool`, signed by an admin keypair.
 *
 * The `operator` you pass must be a key that is registered and frozen in the
 * cc-vrf authority registry for reveals to settle — `init_pool` itself does not
 * touch cc-vrf, it only records the operator the pool trusts. Registering the
 * operator (init_authority + freeze) is done with `@collectorcrypt/vrf-client`;
 * see the webapp README's operator section.
 *
 * Env:
 *   RPC_URL          RPC endpoint (default https://api.devnet.solana.com)
 *   ADMIN_KEYPAIR    path to the admin's Solana CLI keypair JSON
 *                    (default ~/.config/solana/id.json)
 *   OPERATOR_PUBKEY  base58 operator public key (required)
 *   LABEL            cc-vrf authority label (default "gacha-demo")
 *   ENTRY_FEE_SOL    entry fee per pull in SOL (default 0.05)
 *   DEADLINE_SLOTS   refund deadline in slots (default 300)
 *   WEIGHTS          comma-separated tier weights (default "70,25,5")
 *
 * Run: `RPC_URL=… OPERATOR_PUBKEY=… pnpm exec tsx scripts/setup-pool.ts`
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { findPoolPda, getInitPoolInstructionAsync, MAX_TIERS } from '@solana/gacha';
import {
    address,
    appendTransactionMessageInstruction,
    assertIsTransactionWithBlockhashLifetime,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
} from '@solana/kit';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const WS_URL = RPC_URL.replace(/^http/, 'ws');
const LAMPORTS_PER_SOL = 1_000_000_000;

function labelBytes(label: string): number[] {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode(label).slice(0, 32));
    return Array.from(bytes);
}

async function loadSigner(path: string) {
    const bytes = Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
    return await createKeyPairSignerFromBytes(bytes);
}

async function main() {
    const operatorEnv = process.env.OPERATOR_PUBKEY;
    if (!operatorEnv) throw new Error('OPERATOR_PUBKEY is required');
    const operator = address(operatorEnv);

    const adminPath = process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const admin = await loadSigner(adminPath);

    const weights = (process.env.WEIGHTS ?? '70,25,5')
        .split(',')
        .map(w => Number(w.trim()))
        .filter(w => Number.isFinite(w) && w > 0);
    if (weights.length === 0 || weights.length > MAX_TIERS) {
        throw new Error(`WEIGHTS must list 1–${MAX_TIERS} positive numbers`);
    }
    const paddedWeights = [...weights, ...Array<number>(MAX_TIERS - weights.length).fill(0)];

    const entryFee = BigInt(Math.round(Number(process.env.ENTRY_FEE_SOL ?? '0.05') * LAMPORTS_PER_SOL));
    const settleDeadlineSlots = BigInt(Math.max(0, Math.floor(Number(process.env.DEADLINE_SLOTS ?? '300'))));

    const ix = await getInitPoolInstructionAsync({
        admin,
        initPoolData: {
            authorityLabel: labelBytes(process.env.LABEL ?? 'gacha-demo'),
            entryFee,
            operator,
            settleDeadlineSlots,
            tierCount: weights.length,
            weights: paddedWeights,
        },
    });

    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayerSigner(admin, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        tx => appendTransactionMessageInstruction(ix, tx),
    );
    const signed = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(signed);
    await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, { commitment: 'confirmed' });

    const [poolAddress] = await findPoolPda({ admin: admin.address });
    console.log('✓ Pool created');
    console.log(`  admin:     ${admin.address}`);
    console.log(`  operator:  ${operator}`);
    console.log(`  pool:      ${poolAddress}`);
    console.log(`  entry fee: ${Number(entryFee) / LAMPORTS_PER_SOL} SOL`);
    console.log(`  weights:   ${weights.join('/')}`);
    console.log(`  tx:        ${getSignatureFromTransaction(signed)}`);
    console.log('\nSet VITE_POOL_ADMIN in the webapp to feature this pool:');
    console.log(`  VITE_POOL_ADMIN=${admin.address}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
