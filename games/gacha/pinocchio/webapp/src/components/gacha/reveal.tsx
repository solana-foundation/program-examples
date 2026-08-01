import type { Address } from '@solana/kit';
import { Gift, PackageOpen, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePull } from '@/hooks/use-my-pulls';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import { useCluster } from '@/lib/cluster-context';
import { findBuyerAta, PullStatus, rarityColor, rarityLabel } from '@/lib/gacha';
import { clusterSupportsReveal } from '@/lib/solana-client';

/**
 * The pack-opening experience: while the pull is pending it plays the "opening"
 * animation and polls on-chain; the operator's settle flips it to a revealed
 * rarity, which anyone can then claim as the prize NFT.
 */
export function Reveal({ pullAddress, onChange }: { pullAddress: Address; onChange?: () => void }) {
    const { client, signer } = useWallet();
    const { cluster } = useCluster();
    const { run, isSending } = useSend();

    const { pull, refresh } = usePull(pullAddress, { watch: true });
    const status = pull?.status ?? PullStatus.Pending;

    const notified = useRef(false);
    useEffect(() => {
        if (status !== PullStatus.Pending && !notified.current) {
            notified.current = true;
            onChange?.();
        }
    }, [status, onChange]);

    if (!pull) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading pull…</CardContent>
            </Card>
        );
    }

    async function claim() {
        if (!signer || !pull) return;
        const [mint] = await client.gacha.pdas.prizeMint({ pull: pullAddress });
        const buyerAta = await findBuyerAta(pull.buyer, mint);
        const ix = await client.gacha.instructions.claimPrize({
            payer: signer,
            pool: pull.pool,
            pull: pullAddress,
            buyer: pull.buyer,
            buyerAta,
        });
        const sig = await run(ix, 'Prize claimed');
        if (sig) {
            await refresh();
            onChange?.();
        }
    }

    if (status === PullStatus.Pending) {
        const revealable = clusterSupportsReveal(cluster);
        return (
            <Card className="overflow-hidden">
                <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                    <div className="pack-shake text-primary">
                        <PackageOpen className="size-16" />
                    </div>
                    <div>
                        <div className="text-lg font-semibold tracking-tight">Opening your pack…</div>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                            {revealable
                                ? 'The operator is revealing your pull on-chain. It resolves the moment the settle transaction confirms.'
                                : `Reveal needs the cc-vrf + Light stack, which is not deployed on ${cluster}. Run on devnet or mainnet to watch the pack open.`}
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const tier = pull.tierSelected;
    const label = rarityLabel(pull) ?? '';
    const color = rarityColor(tier);

    return (
        <Card className="overflow-hidden">
            <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
            <CardContent className="hero-entrance flex flex-col items-center gap-4 py-10 text-center">
                <div
                    className="flex size-16 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
                >
                    <Sparkles className="size-8" />
                </div>
                <div>
                    <div className="text-sm text-muted-foreground">You pulled</div>
                    <div className="mt-1 text-3xl font-black capitalize tracking-tight" style={{ color }}>
                        {label}
                    </div>
                </div>

                {status === PullStatus.Settled && (
                    <Button onClick={() => void claim()} disabled={isSending}>
                        <Gift /> {isSending ? 'Claiming…' : 'Claim prize NFT'}
                    </Button>
                )}
                {status === PullStatus.Claimed && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm text-muted-foreground">
                        <Gift className="size-4" /> Prize NFT minted to the buyer
                    </span>
                )}
            </CardContent>
        </Card>
    );
}
