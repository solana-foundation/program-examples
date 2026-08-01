import { Sparkles } from 'lucide-react';

import { PoolSummary } from '@/components/gacha/pool-summary';
import type { PoolView } from '@/hooks/use-pool';

const STEPS = [
    {
        title: 'Open a pack',
        body: 'Pay the entry fee. Your wallet commits 32 random bytes so the outcome is unknowable — even to the operator — until the buy lands.',
    },
    {
        title: 'The operator reveals',
        body: 'A backend operator settles your pull with a verifiable random function, anchored in Collector Crypt’s cc-vrf registry. The pack “opens” a few seconds later.',
    },
    {
        title: 'Claim & verify',
        body: 'The prize mints as a Token-2022 NFT carrying its rarity. Anyone can reproduce the result off-chain — provably fair.',
    },
];

export function Hero({ pool }: { pool: PoolView | null }) {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <section className="hero-entrance">
                <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5" /> Provably-fair gacha · cc-vrf + Token-2022
                </div>
                <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                    Open a pack. Pull your rarity. Verify the odds.
                </h1>
                <p className="mt-4 max-w-xl text-lg text-muted-foreground">
                    A loot-box game where every reveal is anchored in a verifiable random function — connect a wallet to
                    open a pull.
                </p>
            </section>

            {pool && (
                <div className="mt-10 max-w-2xl">
                    <PoolSummary pool={pool} />
                </div>
            )}

            <section className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
                {STEPS.map((step, i) => (
                    <div key={step.title} className="flex flex-col gap-3 bg-card p-6">
                        <span className="font-mono text-sm text-muted-foreground tabular-nums">
                            {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                    </div>
                ))}
            </section>
        </div>
    );
}
