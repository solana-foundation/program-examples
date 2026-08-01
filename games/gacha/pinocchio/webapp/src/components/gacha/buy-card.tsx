import { findPullPda } from '@solana/gacha';
import type { Address } from '@solana/kit';
import { Dices, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import type { PoolView } from '@/hooks/use-pool';
import { formatSol } from '@/lib/format';
import { newClientSeed } from '@/lib/gacha';

export function BuyCard({ pool, onOpened }: { pool: PoolView; onOpened: (pull: Address) => void }) {
    const { address, client, signer } = useWallet();
    const { run, isSending } = useSend();

    async function open() {
        if (!signer || !address) return;
        const index = pool.pool.pullsCount;
        const [pull] = await findPullPda({ buyer: address, index, pool: pool.poolAddress });
        const clientSeed = newClientSeed();
        const ix = await client.gacha.instructions.buyPull({
            buyer: signer,
            buyPullData: { clientSeed: Array.from(clientSeed) },
            pool: pool.poolAddress,
            pull,
            vault: pool.vaultAddress,
        });
        const sig = await run(ix, 'Pack opened');
        if (sig) onOpened(pull);
    }

    return (
        <Card className="overflow-hidden">
            <CardHeader>
                <p className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">First edition</p>
                <CardTitle className="text-xl">SIMD All-Stars</CardTitle>
                <CardDescription>
                    One proposal-inspired character per pack. Your wallet mixes fresh entropy into the VRF input, so
                    nobody knows the rarity before your buy lands.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="mx-auto w-full max-w-[180px] overflow-hidden rounded-xl border bg-secondary shadow-sm">
                    <img
                        src="/cards/simd/simd-all-stars-pack.jpg"
                        alt="A sealed SIMD All-Stars trading-card pack with visible crimped edges"
                        className="aspect-[2/3] h-auto w-full object-cover"
                    />
                </div>
                <Button className="w-full" size="lg" onClick={() => void open()} disabled={isSending}>
                    <Dices /> {isSending ? 'Opening…' : `Open one pack · ${formatSol(pool.pool.entryFee)} SOL`}
                </Button>
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" /> Provably fair · every pull is independently verifiable
                </p>
            </CardContent>
        </Card>
    );
}
