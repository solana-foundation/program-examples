import { ChevronDown, Circle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCluster } from '@/lib/cluster-context';
import { CLUSTER_LABELS, CLUSTERS, type ClusterMoniker } from '@/lib/solana-client';

const CLUSTER_COLORS: Record<ClusterMoniker, string> = {
    mainnet: '#22c55e',
    devnet: '#3b82f6',
    localnet: '#a3a3a3',
};

export function ClusterSelect() {
    const { cluster, setCluster } = useCluster();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                    <Circle className="size-2 shrink-0" fill={CLUSTER_COLORS[cluster]} stroke="none" />
                    {CLUSTER_LABELS[cluster]}
                    <ChevronDown className="opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Network</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CLUSTERS.map(c => (
                    <DropdownMenuItem key={c} onClick={() => setCluster(c)}>
                        <Circle className="size-2 shrink-0" fill={CLUSTER_COLORS[c]} stroke="none" />
                        {CLUSTER_LABELS[c]}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
