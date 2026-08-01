import { Sparkles } from 'lucide-react';

import { PoolSummary } from '@/components/gacha/pool-summary';
import type { PoolView } from '@/hooks/use-pool';

const STEPS = [
    {
        title: 'Open a pack',
        body: 'Your wallet commits fresh entropy, keeping the card rarity unknowable — even to the operator — until the buy lands.',
    },
    {
        title: 'Break the seal',
        body: 'A verifiable random function settles the pull. Tear open the physical wrapper once the result confirms on-chain.',
    },
    {
        title: 'Meet a SIMD',
        body: 'Reveal a proposal-inspired character, read the source document, then claim the collectible as a Token-2022 NFT.',
    },
];

export function Hero({ pool }: { pool: PoolView | null }) {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <section className="hero-entrance grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        <Sparkles className="size-3.5" /> SIMD-inspired collectibles · cc-vrf + Token-2022
                    </div>
                    <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                        Open a pack. Pull a piece of Solana’s future.
                    </h1>
                    <p className="mt-4 max-w-xl text-lg text-muted-foreground">
                        SIMD All-Stars turns Solana Improvement Documents into character-driven trading cards, then lets
                        a verifiable pull choose yours.
                    </p>
                </div>
                <div className="simd-pending-arena flex min-h-[390px] items-center justify-center overflow-hidden rounded-2xl border p-8">
                    <img
                        src="/cards/simd/simd-all-stars-pack.jpg"
                        alt="A sealed SIMD All-Stars trading-card pack with visible crimped edges"
                        className="simd-pack-arrival h-auto w-full max-w-[220px] select-none shadow-xl"
                    />
                </div>
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
