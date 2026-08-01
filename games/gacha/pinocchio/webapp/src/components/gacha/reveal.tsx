import { getRefundPullInstructionAsync } from '@solana/gacha';
import type { Address } from '@solana/kit';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSWRConfig } from 'swr';

import { PendingPackStage, SimdRevealStage } from '@/components/gacha/simd-reveal-stage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCurrentSlot } from '@/hooks/use-current-slot';
import { usePull } from '@/hooks/use-my-pulls';
import type { PoolView } from '@/hooks/use-pool';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import { useCluster } from '@/lib/cluster-context';
import { findBuyerAta, isPullRefundable, pullRefundSlot, PullStatus, rarityColor, rarityLabel } from '@/lib/gacha';
import { simdCardForTier } from '@/lib/simd-cards';
import { clusterSupportsReveal } from '@/lib/solana-client';

/**
 * The pack-opening experience: while the pull is pending it plays the "opening"
 * animation and polls on-chain; the operator's settle flips it to a revealed
 * rarity, which anyone can then claim as the prize NFT.
 */
export function Reveal({
    pool,
    pullAddress,
    onChange,
    onRefunded,
}: {
    pool: PoolView;
    pullAddress: Address;
    onChange?: () => void;
    onRefunded?: () => void;
}) {
    const { client, signer } = useWallet();
    const { cluster } = useCluster();
    const { run, isSending } = useSend();
    const { mutate } = useSWRConfig();

    const { pull, refresh } = usePull(pullAddress, { watch: true });
    const status = pull?.status ?? PullStatus.Pending;
    const { slot } = useCurrentSlot(status === PullStatus.Pending ? 5_000 : 0);

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

    async function refund() {
        if (!signer || !pull) return;
        const ix = await getRefundPullInstructionAsync({
            buyer: signer,
            pool: pool.poolAddress,
            pull: pullAddress,
            vault: pool.vaultAddress,
        });
        const sig = await run(ix, 'Pull refunded');
        if (sig) {
            await mutate(['my-pulls', cluster, pull.pool, pull.buyer]);
            onRefunded?.();
            onChange?.();
        }
    }

    if (status === PullStatus.Pending) {
        const revealable = clusterSupportsReveal(cluster);
        const refundable = isPullRefundable(pull, pool.pool, slot);
        const refundSlot = pullRefundSlot(pull, pool.pool);
        const slotsUntilRefund = slot === null || slot >= refundSlot ? 0n : refundSlot - slot;

        if (refundable) {
            return (
                <PendingPackStage
                    action={
                        <Button onClick={() => void refund()} disabled={isSending}>
                            <RotateCcw aria-hidden="true" /> {isSending ? 'Refunding…' : 'Refund pull'}
                        </Button>
                    }
                    detail="Settlement can still win the race until your refund confirms."
                    eyebrow="Operator timeout"
                    message="The operator did not settle within the configured window. You can now reclaim the entry fee and pull-account rent."
                    state="refundable"
                    title="Your pull is refundable."
                />
            );
        }

        const deadlineDetail =
            slot === null
                ? 'Checking when the refund window opens…'
                : `${slotsUntilRefund.toString()} slot${slotsUntilRefund === 1n ? '' : 's'} until refund is available.`;

        return (
            <PendingPackStage
                detail={deadlineDetail}
                eyebrow={revealable ? 'Waiting for operator' : 'Reveal unavailable'}
                message={
                    revealable
                        ? 'The operator worker settles this pull without another wallet approval. This view updates automatically when the transaction confirms.'
                        : `Reveal needs the cc-vrf + Light stack, which is not deployed on ${cluster}. Run on devnet or mainnet to watch the pack open.`
                }
                state={revealable ? 'waiting' : 'unavailable'}
                title={revealable ? 'Your pack is in the reveal queue.' : `This pack cannot settle on ${cluster}.`}
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
