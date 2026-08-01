'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { getExplorerUrl } from './explorer';
import { CLUSTERS, type ClusterMoniker } from './solana-client';

type ClusterContextValue = {
    cluster: ClusterMoniker;
    setCluster: (cluster: ClusterMoniker) => void;
    getExplorerUrl: (path: string) => string;
};

const ClusterContext = createContext<ClusterContextValue | null>(null);

const STORAGE_KEY = 'gacha-cluster';

function normalize(id: string | undefined | null): ClusterMoniker | null {
    if (!id) return null;
    const bare = id.replace(/^solana:/, '') as ClusterMoniker;
    return CLUSTERS.includes(bare) ? bare : null;
}

function readInitialCluster(): ClusterMoniker {
    if (typeof window === 'undefined') return normalize(process.env.NEXT_PUBLIC_DEFAULT_CLUSTER) ?? 'devnet';
    try {
        const stored = normalize(localStorage.getItem(STORAGE_KEY));
        if (stored) return stored;
    } catch {
        // localStorage unavailable (e.g. Safari private mode)
    }
    return normalize(process.env.NEXT_PUBLIC_DEFAULT_CLUSTER) ?? 'devnet';
}

export function ClusterProvider({ children }: { children: ReactNode }) {
    const [cluster, setClusterState] = useState<ClusterMoniker>(readInitialCluster);

    const setCluster = useCallback((next: ClusterMoniker) => {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // localStorage unavailable
        }
        setClusterState(next);
    }, []);

    const value = useMemo<ClusterContextValue>(
        () => ({ cluster, setCluster, getExplorerUrl: (path: string) => getExplorerUrl(path, cluster) }),
        [cluster, setCluster],
    );

    return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useCluster() {
    const ctx = useContext(ClusterContext);
    if (!ctx) throw new Error('useCluster must be used within ClusterProvider');
    return ctx;
}
