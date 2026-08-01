import { Package, Timer } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBalance } from '@/hooks/use-balance';
import type { PoolView } from '@/hooks/use-pool';
import { labelToString, rarityColor, tierOdds } from '@/lib/gacha';
import { formatSol, shortenAddress } from '@/lib/format';

export function PoolSummary({ pool }: { pool: PoolView }) {
    const odds = tierOdds(pool.pool);
    const vault = useBalance(pool.vaultAddress);
    const label = labelToString(pool.pool.authorityLabel);

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                    <Package className="size-4" /> Pool
                </CardTitle>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                    <Timer className="size-3.5" /> refund after {pool.pool.settleDeadlineSlots.toString()} slots
                </span>
            </CardHeader>
            <CardContent className="space-y-5">
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
                    <Stat label="Entry" value={`${formatSol(pool.pool.entryFee)} SOL`} />
                    <Stat label="Pot" value={vault.lamports != null ? `${formatSol(vault.lamports)} SOL` : '—'} />
                    <Stat label="Opened" value={pool.pool.pullsCount.toString()} />
                </dl>

                <div className="space-y-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Drop odds
                    </div>
                    {odds.map(tier => (
                        <div key={tier.tier} className="flex items-center gap-3">
                            <span
                                className="w-24 shrink-0 text-sm font-medium capitalize"
                                style={{ color: rarityColor(tier.tier) }}
                            >
                                {tier.label}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                                <div
                                    className="h-full rounded-full"
                                    style={{ width: `${tier.pct}%`, backgroundColor: rarityColor(tier.tier) }}
                                />
                            </div>
                            <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                {tier.pct.toFixed(1)}%
                            </span>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                        Operator <span className="font-mono">{shortenAddress(pool.pool.operator)}</span>
                    </span>
                    {label && (
                        <span>
                            cc-vrf label <span className="font-mono">{label}</span>
                        </span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-card p-4">
            <dd className="font-mono text-xl font-bold tabular-nums leading-none">{value}</dd>
            <dt className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
        </div>
    );
}
