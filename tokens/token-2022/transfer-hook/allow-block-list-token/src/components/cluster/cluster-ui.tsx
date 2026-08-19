'use client';

import { useSolanaClient } from '@solana/connector/react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCluster } from './cluster-data-access';

export function ExplorerLink({ path, label, className }: { path: string; label: string; className?: string }) {
    const { getExplorerUrl } = useCluster();
    return (
        <a
            href={getExplorerUrl(path)}
            target="_blank"
            rel="noopener noreferrer"
            className={className ? className : `link font-mono`}
        >
            {label}
        </a>
    );
}

export function ClusterChecker({ children }: { children: ReactNode }) {
    const { cluster } = useCluster();
    const { client, ready } = useSolanaClient();

    const query = useQuery({
        enabled: ready && client !== null,
        queryKey: ['version', { cluster, endpoint: cluster.endpoint }],
        queryFn: () => client!.rpc.getVersion().send(),
        retry: 1,
    });
    if (query.isPending) {
        return null;
    }
    if (query.isError || !query.data) {
        return (
            <AppAlert
                action={
                    <Button variant="outline" onClick={() => query.refetch()}>
                        Refresh
                    </Button>
                }
            >
                Error connecting to cluster <span className="font-bold">{cluster.name}</span>.
            </AppAlert>
        );
    }
    return children;
}

export function ClusterUiSelect() {
    const { clusters, setCluster, cluster } = useCluster();
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">{cluster.name}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {clusters.map(item => (
                    <DropdownMenuItem key={item.name} onClick={() => setCluster(item)}>
                        {item.name}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
