import { decodePool, GACHA_PROGRAM_ADDRESS, type Pool } from '@solana/gacha';
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

const FEATURED_ADMIN = process.env.NEXT_PUBLIC_POOL_ADMIN?.trim() || null;

/** Resolves the featured pool: the configured admin's pool, or the first discovered pool. */
export function useFeaturedPool() {
    const { cluster } = useCluster();
    const client = useAppClient();

    const { data, error, isLoading, mutate } = useSWR(
        ['featured-pool', cluster, FEATURED_ADMIN] as const,
        async (): Promise<PoolView | null> => {
            if (FEATURED_ADMIN) {
                const admin = address(FEATURED_ADMIN);
                return await loadPool(client, admin);
            }
            const pools = await discoverPools(client);
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
        async ([, , adminAddr]) => await loadPool(client, adminAddr),
        { refreshInterval: 15_000 },
    );

    return { error, isLoading, pool: data ?? null, refresh: () => mutate() };
}

type Client = ReturnType<typeof useAppClient>;

async function loadPool(client: Client, admin: Address): Promise<PoolView | null> {
    const [poolAddress] = await client.gacha.pdas.pool({ admin });
    const [vaultAddress] = await client.gacha.pdas.vault({ admin });
    const account = await client.gacha.accounts.pool.fetchMaybe(poolAddress);
    if (!account.exists) return null;
    return { admin, pool: account.data, poolAddress, vaultAddress };
}

async function discoverPools(client: Client): Promise<PoolView[]> {
    const base64 = getBase64Encoder();
    const accounts = await client.rpc
        .getProgramAccounts(GACHA_PROGRAM_ADDRESS, {
            encoding: 'base64',
            filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
        })
        .send();

    const views: PoolView[] = [];
    for (const { pubkey, account } of accounts) {
        const bytes = new Uint8Array(base64.encode(account.data[0]));
        const pool = client.gacha.accounts.pool.decode(bytes);
        const [vaultAddress] = await client.gacha.pdas.vault({ admin: pool.admin });
        views.push({ admin: pool.admin, pool, poolAddress: pubkey, vaultAddress });
    }
    return views;
}

export { decodePool };
