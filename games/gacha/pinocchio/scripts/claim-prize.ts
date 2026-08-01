/**
 * Claims the prize NFT for a Settled pull with `claim_prize`. Mints the
 * Token-2022 NFT (decimals 0, supply 1, rarity metadata) to the pull's buyer
 * and marks the pull Claimed. Any signer may pay; the NFT still goes to the
 * recorded buyer.
 *
 * Env:
 *   RPC_URL       RPC endpoint (default https://api.devnet.solana.com)
 *   PAYER_KEYPAIR path to the fee payer keypair (default ~/.config/solana/id.json)
 *   PULL          the settled pull address to claim (required)
 *
 * Run: `RPC_URL=… PULL=… pnpm exec tsx scripts/claim-prize.ts`
 */

import { homedir } from 'node:os';

import { fetchPull, findPrizeMintPda, getClaimPrizeInstructionAsync } from '@solana/gacha';
import { type Address, address, createClient, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;

async function deriveAta(owner: Address, mint: Address): Promise<Address> {
    const [ata] = await getProgramDerivedAddress({
        programAddress: ATA_PROGRAM,
        seeds: [
            getAddressEncoder().encode(owner),
            getAddressEncoder().encode(TOKEN_2022_PROGRAM),
            getAddressEncoder().encode(mint),
        ],
    });
    return ata;
}

async function main(): Promise<void> {
    const pullEnv = process.env.PULL;
    if (!pullEnv) throw new Error('PULL is required');
    const pull = address(pullEnv);

    const payerPath = process.env.PAYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const client = await createClient()
        .use(signerFromFile(payerPath))
        .use(solanaRpc({ rpcUrl: RPC_URL }));
    const payer = client.payer;

    const pullAccount = await fetchPull(client.rpc, pull);
    const { buyer, pool } = pullAccount.data;

    const [mint] = await findPrizeMintPda({ pull });
    const buyerAta = await deriveAta(buyer, mint);

    const ix = await getClaimPrizeInstructionAsync({ buyer, buyerAta, mint, payer, pool, pull });

    const { context } = await client.sendTransaction(ix);

    console.log('✓ Prize claimed');
    console.log(`  pull:     ${pull}`);
    console.log(`  buyer:    ${buyer}`);
    console.log(`  mint:     ${mint}`);
    console.log(`  buyerAta: ${buyerAta}`);
    console.log(`  tx:       ${context.signature}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
