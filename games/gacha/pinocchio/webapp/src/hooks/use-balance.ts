import { type Address } from '@solana/kit';
import { useEffect } from 'react';
import useSWR from 'swr';

import { useAppClient } from '@/lib/client-provider';
import { useCluster } from '@/lib/cluster-context';

/** The wallet's SOL balance, refreshed on account changes and periodically. */
export function useBalance(address?: Address) {
    const { cluster } = useCluster();
    const client = useAppClient();

    const { data, isLoading, error, mutate } = useSWR(
        address ? (['balance', cluster, address] as const) : null,
        async ([, , addr]) => {
            const { value } = await client.rpc.getBalance(addr).send();
            return value;
        },
        { refreshInterval: 30_000, revalidateOnFocus: true },
    );

    useEffect(() => {
        if (!address) return;
        const abortController = new AbortController();

        void (async () => {
            try {
                const notifications = await client.rpcSubscriptions
                    .accountNotifications(address, { commitment: 'confirmed' })
                    .subscribe({ abortSignal: abortController.signal });
                for await (const notification of notifications) {
                    void mutate(notification.value.lamports, { revalidate: false });
                }
            } catch {
                // SWR polling and focus revalidation remain as fallback.
            }
        })();

        return () => abortController.abort();
    }, [address, client, mutate]);

    return { error, isLoading, lamports: data ?? null, mutate };
}
