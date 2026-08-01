import {
    decodePool,
    fetchMaybePool,
    findPoolPda,
    findVaultPda,
    GACHA_PROGRAM_ADDRESS,
    getPoolDecoder,
    type Pool,
} from '@solana/gacha';
import { type Address, address, getBase64Encoder } from '@solana/kit';
import useSWR from 'swr';

import { useAppClient } from '@/lib/client-provider';
import { useCluster } from '@/lib/cluster-context';

const POOL_ACCOUNT_SIZE = 163n;

export type PoolView = {
    admin: Address;
    pool: Pool;
    poolAddress: Address;
    vaultAddress: Address;
};

const FEATURED_ADMIN = import.meta.env.VITE_POOL_ADMIN?.trim() || null;

/** Resolves the featured pool: the `VITE_POOL_ADMIN` pool if configured, else the first discovered. */
export function useFeaturedPool() {
    const { cluster } = useCluster();
    const client = useAppClient();

    const { data, error, isLoading, mutate } = useSWR(
        ['featured-pool', cluster, FEATURED_ADMIN] as const,
        async (): Promise<PoolView | null> => {
            if (FEATURED_ADMIN) {
                const admin = address(FEATURED_ADMIN);
                return await loadPool(client.rpc, admin);
            }
            const pools = await discoverPools(client.rpc);
            return pools[0] ?? null;
        },
        { refreshInterval: 15_000 },
    );

    return { error, isLoading, pool: data ?? null, refresh: () => mutate() };
}

/** Loads a specific admin's pool (used by the admin panel to read back the caller's pool). */
export function usePool(admin: Address | null) {
    const { cluster } = useCluster();
    const client = useAppClient();

    const { data, error, isLoading, mutate } = useSWR(
        admin ? (['pool', cluster, admin] as const) : null,
        async ([, , adminAddr]) => await loadPool(client.rpc, adminAddr),
        { refreshInterval: 15_000 },
    );

    return { error, isLoading, pool: data ?? null, refresh: () => mutate() };
}

async function loadPool(rpc: ReturnType<typeof useAppClient>['rpc'], admin: Address): Promise<PoolView | null> {
    const [poolAddress] = await findPoolPda({ admin });
    const [vaultAddress] = await findVaultPda({ admin });
    const account = await fetchMaybePool(rpc, poolAddress);
    if (!account.exists) return null;
    return { admin, pool: account.data, poolAddress, vaultAddress };
}

async function discoverPools(rpc: ReturnType<typeof useAppClient>['rpc']): Promise<PoolView[]> {
    const base64 = getBase64Encoder();
    const accounts = await rpc
        .getProgramAccounts(GACHA_PROGRAM_ADDRESS, {
            encoding: 'base64',
            filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
        })
        .send();

    const views: PoolView[] = [];
    for (const { pubkey, account } of accounts) {
        const bytes = new Uint8Array(base64.encode(account.data[0]));
        const pool = getPoolDecoder().decode(bytes);
        const [vaultAddress] = await findVaultPda({ admin: pool.admin });
        views.push({ admin: pool.admin, pool, poolAddress: pubkey, vaultAddress });
    }
    return views;
}

export { decodePool };
