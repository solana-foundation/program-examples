import { Dices, FlaskConical, Maximize2, RotateCcw, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { RevealDialog } from '@/components/gacha/reveal-dialog';
import { PendingPackStage, SimdRevealStage } from '@/components/gacha/simd-reveal-stage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SIMD_CARDS } from '@/lib/simd-cards';

const PREVIEW_RARITIES = [
    { accentColor: 'var(--color-rarity-common)', label: 'common' },
    { accentColor: 'var(--color-rarity-uncommon)', label: 'uncommon' },
    { accentColor: 'var(--color-rarity-rare)', label: 'rare' },
    { accentColor: 'var(--color-rarity-epic)', label: 'epic' },
    { accentColor: 'var(--color-rarity-legendary)', label: 'legendary' },
    { accentColor: 'var(--color-rarity-mythic)', label: 'mythic' },
    { accentColor: 'var(--color-rarity-exotic)', label: 'exotic' },
    { accentColor: 'var(--color-rarity-divine)', label: 'divine' },
] as const;

type PreviewMode = 'pending' | 'refundable' | 'settled';

function randomCardIndex(): number {
    const entropy = new Uint32Array(1);
    crypto.getRandomValues(entropy);
    return (entropy[0] ?? 0) % SIMD_CARDS.length;
}

/** A browser-only simulator for exercising every state of the SIMD pack reveal. */
export function SimdPreview() {
    const [cardIndex, setCardIndex] = useState(SIMD_CARDS.length - 1);
    const [mode, setMode] = useState<PreviewMode>('settled');
    const [isClaimed, setIsClaimed] = useState(false);
    const [previewKey, setPreviewKey] = useState(0);
    const [modalOpen, setModalOpen] = useState(false);
    const card = SIMD_CARDS[cardIndex] ?? SIMD_CARDS[0]!;
    const rarity = PREVIEW_RARITIES[cardIndex] ?? PREVIEW_RARITIES[0];

    function resetPreview(nextIndex = cardIndex, nextMode: PreviewMode = mode) {
        setCardIndex(nextIndex);
        setMode(nextMode);
        setIsClaimed(false);
        setPreviewKey(value => value + 1);
    }

    const stage: ReactNode =
        mode === 'pending' ? (
            <PendingPackStage
                detail="184 slots until refund is available."
                eyebrow="Waiting for operator"
                message="The pull API settles and mints without another wallet approval. This view updates automatically when the transactions confirm."
            />
        ) : mode === 'refundable' ? (
            <PendingPackStage
                action={
                    <Button onClick={() => resetPreview(cardIndex, 'pending')}>
                        <RotateCcw aria-hidden="true" /> Simulate refund
                    </Button>
                }
                detail="Settlement can still win the race until your refund confirms."
                eyebrow="Operator timeout"
                message="The operator did not settle within the configured window. You can now reclaim the entry fee and pull-account rent."
                state="refundable"
                title="Your pull is refundable."
            />
        ) : (
            <SimdRevealStage
                key={`${card.number}:${previewKey}:${modalOpen}`}
                accentColor={rarity.accentColor}
                card={card}
                claimLabel="Simulate claim"
                claimedLabel="Simulated claim complete — no NFT was minted"
                isClaimed={isClaimed}
                isClaiming={false}
                onClaim={() => setIsClaimed(true)}
                rarity={rarity.label}
                settledLabel="Settled locally"
            />
        );

    return (
        <div className="min-h-dvh">
            <header className="border-b bg-card">
                <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <FlaskConical className="size-4" aria-hidden="true" />
                        </span>
                        <div>
                            <p className="font-semibold">SIMD Reveal Lab</p>
                            <p className="text-xs text-muted-foreground">Local presentation simulator</p>
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
                        <WifiOff className="size-3.5" aria-hidden="true" /> No wallet, RPC, or transactions
                    </span>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
                <section className="max-w-2xl">
                    <p className="font-mono text-xs text-muted-foreground uppercase">UI simulator</p>
                    <h1 className="mt-2 text-balance text-3xl font-bold sm:text-5xl">
                        Open packs without touching devnet.
                    </h1>
                    <p className="mt-4 text-pretty text-muted-foreground">
                        Pick any card, preview the pending state, settle it locally, replay the wrapper animation, and
                        simulate the claim state. Everything on this page stays in browser memory.
                    </p>
                </section>

                <Card className="mt-8">
                    <CardContent className="grid gap-5 sm:grid-cols-[minmax(240px,1fr)_auto] sm:items-end">
                        <label className="grid gap-2 text-sm font-medium" htmlFor="preview-card">
                            Card and rarity
                            <select
                                id="preview-card"
                                value={cardIndex}
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onChange={event => resetPreview(Number(event.currentTarget.value), 'settled')}
                            >
                                {SIMD_CARDS.map((option, index) => (
                                    <option key={option.number} value={index}>
                                        {option.character} · SIMD {option.number} · {PREVIEW_RARITIES[index]?.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => resetPreview(randomCardIndex(), 'settled')}>
                                <Dices aria-hidden="true" /> Random card
                            </Button>
                            <Button variant="outline" onClick={() => resetPreview()}>
                                <RotateCcw aria-hidden="true" /> Reset pack
                            </Button>
                        </div>

                        <div
                            className="flex flex-wrap items-center gap-2 sm:col-span-2"
                            role="group"
                            aria-label="Pull state"
                        >
                            <span className="mr-1 text-sm font-medium">Pull state</span>
                            <Button
                                size="sm"
                                variant={mode === 'pending' ? 'secondary' : 'outline'}
                                aria-pressed={mode === 'pending'}
                                onClick={() => resetPreview(cardIndex, 'pending')}
                            >
                                Pending
                            </Button>
                            <Button
                                size="sm"
                                variant={mode === 'settled' ? 'secondary' : 'outline'}
                                aria-pressed={mode === 'settled'}
                                onClick={() => resetPreview(cardIndex, 'settled')}
                            >
                                Settled
                            </Button>
                            <Button
                                size="sm"
                                variant={mode === 'refundable' ? 'secondary' : 'outline'}
                                aria-pressed={mode === 'refundable'}
                                onClick={() => resetPreview(cardIndex, 'refundable')}
                            >
                                Refundable
                            </Button>
                            <div className="flex gap-2 sm:ml-auto">
                                {mode !== 'settled' && (
                                    <Button size="sm" onClick={() => resetPreview(cardIndex, 'settled')}>
                                        Settle locally
                                    </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>
                                    <Maximize2 aria-hidden="true" /> Open in modal
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <section className="mt-6" aria-label="SIMD pack reveal preview">
                    {stage}
                </section>
            </main>

            <RevealDialog open={modalOpen} onOpenChange={setModalOpen}>
                {modalOpen && stage}
            </RevealDialog>
        </div>
    );
}
