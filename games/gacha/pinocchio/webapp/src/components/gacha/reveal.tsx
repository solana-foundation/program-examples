import type { Address } from '@solana/kit';
import { useEffect, useRef } from 'react';

import { PendingPackStage, SimdRevealStage } from '@/components/gacha/simd-reveal-stage';
import { Card, CardContent } from '@/components/ui/card';
import { usePull } from '@/hooks/use-my-pulls';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import { useCluster } from '@/lib/cluster-context';
import { findBuyerAta, PullStatus, rarityColor, rarityLabel } from '@/lib/gacha';
import { simdCardForTier } from '@/lib/simd-cards';
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
            <PendingPackStage
                message={
                    revealable
                        ? 'The operator is revealing your pull on-chain. It resolves the moment the settle transaction confirms.'
                        : `Reveal needs the cc-vrf + Light stack, which is not deployed on ${cluster}. Run on devnet or mainnet to watch the pack open.`
                }
            />
        );
    }

    const tier = pull.tierSelected;
    const rarity = rarityLabel(pull) ?? 'common';
    const card = simdCardForTier(tier);

    return (
        <SimdRevealStage
            key={`${pullAddress}:${card.number}`}
            accentColor={rarityColor(tier)}
            card={card}
            isClaimed={status === PullStatus.Claimed}
            isClaiming={isSending}
            onClaim={() => void claim()}
            rarity={rarity}
        />
    );
}
