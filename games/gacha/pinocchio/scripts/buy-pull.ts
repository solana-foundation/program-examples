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
import { homedir } from 'node:os';

import { findPullPda, gachaProgram } from '@solana/gacha';
import { address, createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';

async function main(): Promise<void> {
    const buyerPath = process.env.BUYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const client = await createClient()
        .use(signerFromFile(buyerPath))
        .use(solanaRpc({ rpcUrl: RPC_URL }))
        .use(gachaProgram());
    const buyer = client.payer;
    const admin = process.env.POOL_ADMIN ? address(process.env.POOL_ADMIN) : buyer.address;

    const [pool] = await client.gacha.pdas.pool({ admin });
    const [vault] = await client.gacha.pdas.vault({ admin });

    const poolAccount = await client.gacha.accounts.pool.fetch(pool);
    const index = poolAccount.data.pullsCount;
    const [pull] = await findPullPda({ buyer: buyer.address, index, pool });

    const clientSeed = new Uint8Array(randomBytes(32));

    const { context } = await client.gacha.instructions
        .buyPull({
            buyPullData: { clientSeed: Array.from(clientSeed) },
            buyer,
            pool,
            pull,
            vault,
        })
        .sendTransaction();

    console.log('✓ Pull opened (Pending)');
    console.log(`  pool:       ${pool}`);
    console.log(`  buyer:      ${buyer.address}`);
    console.log(`  pull:       ${pull}`);
    console.log(`  index:      ${index}`);
    console.log(`  clientSeed: ${Buffer.from(clientSeed).toString('hex')}`);
    console.log(`  tx:         ${context.signature}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
