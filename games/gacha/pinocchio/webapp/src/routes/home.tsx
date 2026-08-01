import type { Address } from '@solana/kit';
import Link from 'next/link';
import { useState } from 'react';

import { BuyCard } from '@/components/gacha/buy-card';
import { Hero } from '@/components/gacha/hero';
import { PoolSummary } from '@/components/gacha/pool-summary';
import { PullList } from '@/components/gacha/pull-list';
import { Reveal } from '@/components/gacha/reveal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFeaturedPool } from '@/hooks/use-pool';
import { useWallet } from '@/hooks/use-wallet';

export function Home() {
    const { address } = useWallet();
    const { pool, isLoading, refresh } = useFeaturedPool();
    const [activePull, setActivePull] = useState<Address | null>(null);

    if (!address) {
        return <Hero pool={pool} />;
    }

    if (isLoading && !pool) {
        return (
            <Card>
                <CardContent className="py-16 text-center text-sm text-muted-foreground">Loading pool…</CardContent>
            </Card>
        );
    }

    if (!pool) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
                    <h1 className="text-2xl font-bold tracking-tight">No pool found</h1>
                    <p className="max-w-md text-muted-foreground">
                        No gacha pool exists on this network yet. Create one from the Admin page, or point{' '}
                        <code>NEXT_PUBLIC_POOL_ADMIN</code> at an existing pool’s admin.
                    </p>
                    <Button asChild>
                        <Link href="/admin">Go to Admin</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
            <div className="space-y-6">
                <PoolSummary pool={pool} />
                <BuyCard
                    pool={pool}
                    onOpened={setActivePull}
                    onProcessing={setActivePull}
                    onProcessingFailed={(pull, submitted) => {
                        if (!submitted) setActivePull(current => (current === pull ? null : current));
                    }}
                />
            </div>
            <div className="space-y-6">
                {activePull && (
                    <Reveal
                        pool={pool}
                        pullAddress={activePull}
                        onChange={() => void refresh()}
                        onRefunded={() => setActivePull(null)}
                    />
                )}
                <PullList
                    pool={pool}
                    onSelect={setActivePull}
                    onRefunded={pull => {
                        if (pull === activePull) setActivePull(null);
                        void refresh();
                    }}
                />
            </div>
        </div>
    );
}
