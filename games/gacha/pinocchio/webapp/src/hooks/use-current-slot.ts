import useSWR from 'swr';

import { useAppClient } from '@/lib/client-provider';
import { useCluster } from '@/lib/cluster-context';

/** Tracks the current cluster slot for deadline-based UI states. */
export function useCurrentSlot(refreshInterval = 5_000) {
    const { cluster } = useCluster();
    const client = useAppClient();
    const { data, error, isLoading } = useSWR(['slot', cluster], () => client.rpc.getSlot().send(), {
        refreshInterval,
    });

    return { error, isLoading, slot: data ?? null };
}
