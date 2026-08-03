import { CircleAlert, CircleCheck, ExternalLink, Gift, PackageOpen, RotateCcw, Sparkles, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { SimdCard } from '@/lib/simd-cards';

const PACK_IMAGE = '/cards/simd/simd-all-stars-pack.jpg';
const REVEAL_DURATION_MS = 900;

type RevealPhase = 'sealed' | 'revealing' | 'revealed';

type PendingPackStageProps = {
    action?: ReactNode;
    detail?: string;
    eyebrow?: string;
    message: string;
    state?: 'waiting' | 'refundable' | 'unavailable';
    title?: string;
};

/** The pending state shown while a pull awaits settlement or becomes refundable. */
export function PendingPackStage({
    action,
    detail = 'The seal becomes breakable as soon as the pull settles.',
    eyebrow = 'Pull submitted',
    message,
    state = 'waiting',
    title = 'Your pack is in the reveal queue.',
}: PendingPackStageProps) {
    return (
        <Card className="gap-0 overflow-hidden py-0">
            <CardContent className="p-0">
                <div className="grid md:grid-cols-[minmax(280px,0.9fr)_minmax(300px,1.05fr)]">
                    <div className="simd-pending-arena simd-charging-arena relative flex min-h-[520px] items-center justify-center overflow-hidden p-8">
                        <div className="simd-charge-aura" aria-hidden="true" />
                        <div className="simd-charge-aura simd-charge-aura-delay" aria-hidden="true" />
                        <div className="simd-charging-pack">
                            <img
                                src={PACK_IMAGE}
                                alt="A sealed SIMD All-Stars trading-card pack with visible crimped edges"
                                className="simd-charging-pack-image h-auto w-full max-w-[220px] select-none shadow-xl"
                            />
                        </div>
                    </div>
                    <div className="flex min-h-[520px] flex-col justify-center p-7 sm:p-9">
                        <span className="mb-5 flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
                            {state === 'refundable' ? (
                                <RotateCcw className="size-5" aria-hidden="true" />
                            ) : state === 'unavailable' ? (
                                <WifiOff className="size-5" aria-hidden="true" />
                            ) : (
                                <PackageOpen className="size-5" aria-hidden="true" />
                            )}
                        </span>
                        <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">{eyebrow}</p>
                        <h2 className="mt-2 text-balance text-2xl font-bold tracking-tight">{title}</h2>
                        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground" aria-live="polite">
                            {message}
                        </p>
                        {action && <div className="mt-6 flex flex-wrap gap-3">{action}</div>}
                        <div className="mt-6 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
                            {state === 'refundable' ? (
                                <CircleAlert className="size-4" aria-hidden="true" />
                            ) : (
                                <Sparkles className="size-4" aria-hidden="true" />
                            )}
                            <span className="tabular-nums">{detail}</span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

type SimdRevealStageProps = {
    accentColor: string;
    autoReveal?: boolean;
    card: SimdCard;
    claimLabel?: string;
    claimedLabel?: string;
    isClaimed: boolean;
    isClaiming?: boolean;
    onClaim?: () => void;
    rarity: string;
    settledLabel?: string;
};

/** A pack-opening stage that can reveal automatically once its card image is ready. */
export function SimdRevealStage({
    accentColor,
    autoReveal = false,
    card,
    claimLabel = 'Claim prize NFT',
    claimedLabel = 'Prize NFT minted to the buyer',
    isClaimed,
    isClaiming = false,
    onClaim,
    rarity,
    settledLabel = 'Settled on-chain',
}: SimdRevealStageProps) {
    const [phase, setPhase] = useState<RevealPhase>('sealed');
    const [imageReady, setImageReady] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const revealTimer = useRef<number | undefined>(undefined);
    const revealStarted = useRef(false);
    const isRevealed = phase === 'revealed';

    useEffect(() => {
        return () => {
            if (revealTimer.current !== undefined) window.clearTimeout(revealTimer.current);
        };
    }, []);

    useEffect(() => {
        if (isRevealed) headingRef.current?.focus();
    }, [isRevealed]);

    const beginReveal = useCallback(() => {
        if (revealStarted.current) return;
        revealStarted.current = true;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setPhase('revealed');
            return;
        }

        setPhase('revealing');
        revealTimer.current = window.setTimeout(() => setPhase('revealed'), REVEAL_DURATION_MS);
    }, []);

    const handleImageReady = useCallback(() => {
        setImageReady(true);
        if (autoReveal) beginReveal();
    }, [autoReveal, beginReveal]);

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="h-1.5 w-full" style={{ backgroundColor: accentColor }} />
            <CardContent className="p-0">
                <div
                    className="simd-reveal-stage grid md:grid-cols-[minmax(280px,0.9fr)_minmax(300px,1.05fr)]"
                    data-phase={phase}
                >
                    <div className="simd-reveal-arena relative flex min-h-[520px] items-center justify-center overflow-hidden p-8">
                        <div className="simd-reveal-ring" aria-hidden="true" />
                        <div className="simd-prize-card">
                            <img
                                key={card.image}
                                src={card.image}
                                alt={isRevealed ? `${card.character}, the SIMD ${card.number} collectible card` : ''}
                                aria-hidden={!isRevealed}
                                className="h-full w-full object-cover"
                                onLoad={handleImageReady}
                                onError={handleImageReady}
                            />
                        </div>

                        <div className="simd-pack-shell" aria-hidden="true">
                            <div className="simd-pack-piece simd-pack-top">
                                <img src={PACK_IMAGE} alt="" className="simd-pack-image" />
                            </div>
                            <div className="simd-pack-piece simd-pack-body">
                                <img src={PACK_IMAGE} alt="" className="simd-pack-image" />
                            </div>
                        </div>

                        {phase === 'sealed' && !autoReveal && (
                            <Button
                                size="lg"
                                className="absolute inset-x-auto bottom-7 min-w-44 shadow-lg"
                                onClick={beginReveal}
                                disabled={!imageReady}
                            >
                                <PackageOpen aria-hidden="true" />
                                {imageReady ? 'Break the seal' : 'Preparing card…'}
                            </Button>
                        )}
                        {phase === 'revealing' && (
                            <span
                                className="absolute bottom-8 z-10 rounded-full bg-card px-4 py-2 text-sm font-medium shadow-lg"
                                role="status"
                            >
                                Breaking the seal…
                            </span>
                        )}
                    </div>

                    <div className="flex min-h-[520px] flex-col justify-center p-7 sm:p-9">
                        {!isRevealed ? (
                            <div className="simd-anticipation-copy">
                                <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
                                    {settledLabel}
                                </p>
                                <h2 className="mt-2 text-3xl font-bold tracking-tight">Your pull is ready.</h2>
                                <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                                    {autoReveal
                                        ? 'Your pack is opening automatically. The rarity is already locked by the settled pull.'
                                        : 'Break the physical seal to meet a character inspired by an actual Solana Improvement Document. The rarity is already locked by the settled pull.'}
                                </p>
                                <div className="mt-7 grid gap-3 border-t pt-6 text-sm text-muted-foreground">
                                    <p className="flex items-center gap-2">
                                        <CircleCheck className="size-4 text-primary" aria-hidden="true" /> Eight-card
                                        first edition
                                    </p>
                                    <p className="flex items-center gap-2">
                                        <CircleCheck className="size-4 text-primary" aria-hidden="true" /> Official
                                        proposal source included
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="simd-card-copy">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize"
                                        style={{
                                            backgroundColor: `color-mix(in oklch, ${accentColor} 16%, transparent)`,
                                            color: accentColor,
                                        }}
                                    >
                                        {rarity}
                                    </span>
                                    <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                        {card.status}
                                    </span>
                                </div>
                                <p className="mt-6 font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
                                    SIMD {card.number} · {card.role}
                                </p>
                                <h2
                                    ref={headingRef}
                                    tabIndex={-1}
                                    className="mt-2 scroll-mt-24 rounded-sm text-3xl font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-4xl"
                                >
                                    {card.character}
                                </h2>
                                <p className="mt-2 text-lg font-semibold tracking-tight">{card.title}</p>
                                <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                                    {card.summary}
                                </p>

                                <div className="mt-7 flex flex-wrap gap-3 border-t pt-6">
                                    {isClaimed ? (
                                        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm text-muted-foreground">
                                            <Gift className="size-4" aria-hidden="true" /> {claimedLabel}
                                        </span>
                                    ) : onClaim ? (
                                        <Button onClick={onClaim} disabled={isClaiming}>
                                            <Gift aria-hidden="true" /> {isClaiming ? 'Claiming…' : claimLabel}
                                        </Button>
                                    ) : (
                                        <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm text-muted-foreground">
                                            <CircleCheck className="size-4" aria-hidden="true" /> Reveal settled
                                            on-chain
                                        </span>
                                    )}
                                    <Button asChild variant="outline">
                                        <a href={card.href} target="_blank" rel="noreferrer">
                                            Read SIMD {card.number}
                                            <ExternalLink aria-hidden="true" />
                                        </a>
                                    </Button>
                                </div>
                                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                                    Collectible rarity reflects this pull, not the proposal’s status or importance.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
