import { type Pull, PullStatus } from '@solana/gacha';
import { type Address, getBase64Encoder } from '@solana/kit';
import useSWR from 'swr';

import { useAppClient } from '@/lib/client-provider';
import { useCluster } from '@/lib/cluster-context';
import { GACHA_PROGRAM_ADDRESS, PULL_ACCOUNT_SIZE, PULL_OFFSET } from '@/lib/gacha';

export type PullView = { address: Address; pull: Pull };

/** Every pull the given buyer has opened against a pool, newest first. */
export function useMyPulls(poolAddress: Address | null, buyer: Address | null) {
    const { cluster } = useCluster();
    const client = useAppClient();

    const key = poolAddress && buyer ? (['my-pulls', cluster, poolAddress, buyer] as const) : null;

    const { data, error, isLoading, mutate } = useSWR(
        key,
        async ([, , pool, buyerAddr]): Promise<PullView[]> => {
            const base64 = getBase64Encoder();
            const accounts = await client.rpc
                .getProgramAccounts(GACHA_PROGRAM_ADDRESS, {
                    encoding: 'base64',
                    filters: [
                        { dataSize: PULL_ACCOUNT_SIZE },
                        { memcmp: { bytes: pool, encoding: 'base58', offset: PULL_OFFSET.pool } },
                        { memcmp: { bytes: buyerAddr, encoding: 'base58', offset: PULL_OFFSET.buyer } },
                    ],
                })
                .send();

            return accounts
                .map(({ pubkey, account }) => ({
                    address: pubkey,
                    pull: client.gacha.accounts.pull.decode(new Uint8Array(base64.encode(account.data[0]))),
                }))
                .sort((a, b) => Number(b.pull.index - a.pull.index));
        },
        { refreshInterval: 10_000 },
    );

    return { error, isLoading, pulls: data ?? [], refresh: () => mutate() };
}

/**
 * A single pull, polled while it is still pending so the reveal UI flips as soon
 * as the operator settles it on-chain.
 */
export function usePull(pullAddress: Address | null, { watch = false }: { watch?: boolean } = {}) {
    const { cluster } = useCluster();
    const client = useAppClient();

    const { data, error, isLoading, mutate } = useSWR(
        pullAddress ? (['pull', cluster, pullAddress] as const) : null,
        async ([, , addr]): Promise<Pull | null> => {
            const account = await client.gacha.accounts.pull.fetchMaybe(addr);
            return account.exists ? account.data : null;
        },
        {
            refreshInterval: latestPull =>
                watch && (!latestPull || latestPull.status === PullStatus.Pending) ? 2_000 : 0,
        },
    );

    return { error, isLoading, pull: data ?? null, refresh: () => mutate() };
}

export { PullStatus };
