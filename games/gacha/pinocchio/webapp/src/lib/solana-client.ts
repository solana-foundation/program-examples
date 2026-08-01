import { gachaProgram } from '@solana/gacha';
import { createClient, type MicroLamports } from '@solana/kit';
import { rpcAirdrop, solanaRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';

export type ClusterMoniker = 'devnet' | 'mainnet' | 'localnet';

export const CLUSTERS: ClusterMoniker[] = ['devnet', 'mainnet', 'localnet'];

export const CLUSTER_LABELS: Record<ClusterMoniker, string> = {
    devnet: 'Devnet',
    mainnet: 'Mainnet',
    localnet: 'Localnet',
};

const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const MAINNET_RPC = process.env.NEXT_PUBLIC_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Localnet RPC is proxied through a development-only Next.js route to dodge
 * CORS; outside dev it hits the validator directly.
 */
const LOCALNET_RPC = process.env.NODE_ENV === 'development' ? '/api/localnet-rpc' : 'http://localhost:8899';

function httpUrl(cluster: ClusterMoniker): string {
    if (cluster === 'devnet') return DEVNET_RPC;
    if (cluster === 'mainnet') return MAINNET_RPC;
    return LOCALNET_RPC;
}

function wsUrl(cluster: ClusterMoniker): string {
    if (cluster === 'localnet') return 'ws://localhost:8900';
    return httpUrl(cluster).replace(/^http/, 'ws');
}

/**
 * Wallets do not advertise a localnet chain; sign against devnet so wallets stay
 * discoverable while the RPC targets the local validator.
 */
const WALLET_CHAINS: Record<ClusterMoniker, `solana:${string}`> = {
    devnet: 'solana:devnet',
    mainnet: 'solana:mainnet',
    localnet: 'solana:devnet',
};

/**
 * Whether the live reveal path (settle_pull → cc-vrf → Light) can run on a
 * cluster. cc-vrf and Light Protocol are deployed on devnet and mainnet, but a
 * plain localnet has neither, so only buy/refund are reachable there.
 */
export function clusterSupportsReveal(cluster: ClusterMoniker): boolean {
    return cluster !== 'localnet';
}

export function createAppClient(cluster: ClusterMoniker) {
    return createClient()
        .use(walletSigner({ chain: WALLET_CHAINS[cluster] }))
        .use(
            solanaRpc({
                rpcUrl: httpUrl(cluster),
                rpcSubscriptionsUrl: wsUrl(cluster),
                transactionConfig: {
                    microLamportsPerComputeUnit: 1000n as MicroLamports,
                },
            }),
        )
        .use(rpcAirdrop())
        .use(gachaProgram());
}

export type AppClient = ReturnType<typeof createAppClient>;
