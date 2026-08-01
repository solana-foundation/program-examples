/**
 * Opens a pull on a gacha pool with `buy_pull`, signed by the buyer keypair,
 * leaving it Pending for the operator crank to settle. Mints 32 random bytes of
 * `clientSeed` (the buyer entropy that makes the VRF input unpredictable) and
 * uses `pool.pulls_count` as the pull index.
 *
 * Env:
 *   RPC_URL       RPC endpoint (default https://api.devnet.solana.com)
 *   BUYER_KEYPAIR path to the buyer's keypair (default ~/.config/solana/id.json)
 *   POOL_ADMIN    admin whose pool to buy from (default = buyer)
 *
 * Run: `RPC_URL=… pnpm exec tsx scripts/buy-pull.ts`
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { fetchPool, findPoolPda, findPullPda, findVaultPda, getBuyPullInstructionAsync } from '@solana/gacha';
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

async function loadSigner(path: string) {
    const bytes = Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
    return await createKeyPairSignerFromBytes(bytes);
}

async function main(): Promise<void> {
    const buyerPath = process.env.BUYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const buyer = await loadSigner(buyerPath);
    const admin = process.env.POOL_ADMIN ? address(process.env.POOL_ADMIN) : buyer.address;

    const [pool] = await findPoolPda({ admin });
    const [vault] = await findVaultPda({ admin });

    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);

    const poolAccount = await fetchPool(rpc, pool);
    const index = poolAccount.data.pullsCount;
    const [pull] = await findPullPda({ buyer: buyer.address, index, pool });

    const clientSeed = new Uint8Array(randomBytes(32));

    const ix = await getBuyPullInstructionAsync({
        buyPullData: { clientSeed: Array.from(clientSeed) },
        buyer,
        pool,
        pull,
        vault,
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        tx => setTransactionMessageFeePayerSigner(buyer, tx),
        tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        tx => appendTransactionMessageInstruction(ix, tx),
    );
    const signed = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(signed);
    await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, { commitment: 'confirmed' });

    console.log('✓ Pull opened (Pending)');
    console.log(`  pool:       ${pool}`);
    console.log(`  buyer:      ${buyer.address}`);
    console.log(`  pull:       ${pull}`);
    console.log(`  index:      ${index}`);
    console.log(`  clientSeed: ${Buffer.from(clientSeed).toString('hex')}`);
    console.log(`  tx:         ${getSignatureFromTransaction(signed)}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
