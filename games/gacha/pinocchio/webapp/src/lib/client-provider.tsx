'use client';

import { ClientProvider, useClient } from '@solana/react';
import { useMemo, type ReactNode } from 'react';

import { useCluster } from './cluster-context';
import { type AppClient, createAppClient } from './solana-client';

export function AppClientProvider({ children }: { children: ReactNode }) {
    const { cluster } = useCluster();
    const client = useMemo(() => createAppClient(cluster), [cluster]);

    return <ClientProvider client={client}>{children}</ClientProvider>;
}

export function useAppClient() {
    return useClient<AppClient>();
}
