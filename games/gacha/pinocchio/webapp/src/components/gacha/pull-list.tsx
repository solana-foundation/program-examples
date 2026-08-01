import { getRefundPullInstructionAsync } from '@solana/gacha';
import type { Address } from '@solana/kit';
import { Eye, RotateCcw } from 'lucide-react';

import { RarityBadge } from '@/components/gacha/rarity-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentSlot } from '@/hooks/use-current-slot';
import { useMyPulls, type PullView } from '@/hooks/use-my-pulls';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import type { PoolView } from '@/hooks/use-pool';
import { isPullRefundable, PullStatus, rarityLabel, statusLabel } from '@/lib/gacha';
import { cn } from '@/lib/utils';

export function PullList({
    pool,
    onSelect,
    onRefunded,
}: {
    pool: PoolView;
    onSelect: (pull: Address) => void;
    onRefunded?: (pull: Address) => void;
}) {
    const { address } = useWallet();
    const { pulls, refresh } = useMyPulls(pool.poolAddress, address);
    const { slot } = useCurrentSlot();

    if (pulls.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Your pulls</CardTitle>
                </CardHeader>
                <CardContent className="pb-6 text-sm text-muted-foreground">
                    No pulls yet. Open a pack to get started.
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Your pulls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {pulls.map(view => (
                    <PullRow
                        key={view.address}
                        view={view}
                        pool={pool}
                        currentSlot={slot}
                        onSelect={onSelect}
                        onRefunded={() => {
                            void refresh();
                            onRefunded?.(view.address);
                        }}
                    />
                ))}
            </CardContent>
        </Card>
    );
}

function PullRow({
    view,
    pool,
    currentSlot,
    onSelect,
    onRefunded,
}: {
    view: PullView;
    pool: PoolView;
    currentSlot: bigint | null;
    onSelect: (pull: Address) => void;
    onRefunded: () => void;
}) {
    const { signer } = useWallet();
    const { run, isSending } = useSend();
    const { pull, address } = view;
    const label = rarityLabel(pull);

    const refundable = isPullRefundable(pull, pool.pool, currentSlot);

    async function refund() {
        if (!signer) return;
        const ix = await getRefundPullInstructionAsync({
            buyer: signer,
            pool: pool.poolAddress,
            pull: address,
            vault: pool.vaultAddress,
        });
        const sig = await run(ix, 'Pull refunded');
        if (sig) onRefunded();
    }

    return (
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">#{pull.index.toString()}</span>
            <StatusChip status={pull.status} />
            {label && <RarityBadge tier={pull.tierSelected} label={label} />}
            <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => onSelect(address)}>
                    <Eye /> {pull.status === PullStatus.Settled ? 'Reveal' : 'View'}
                </Button>
                {refundable && (
                    <Button variant="outline" size="sm" onClick={() => void refund()} disabled={isSending}>
                        <RotateCcw /> Refund
                    </Button>
                )}
            </div>
        </div>
    );
}

function StatusChip({ status }: { status: number }) {
    const text = statusLabel(status);
    return (
        <span
            className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                status === PullStatus.Pending && 'bg-secondary text-muted-foreground',
                status === PullStatus.Settled && 'bg-emerald-500/10 text-emerald-600',
                status === PullStatus.Claimed && 'bg-sand-200 text-foreground',
            )}
        >
            {text}
        </span>
    );
}
