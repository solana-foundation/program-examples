import { findPullPda, getBuyPullInstructionAsync } from '@solana/gacha';
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
    const { address, signer } = useWallet();
    const { run, isSending } = useSend();

    async function open() {
        if (!signer || !address) return;
        const index = pool.pool.pullsCount;
        const [pull] = await findPullPda({ buyer: address, index, pool: pool.poolAddress });
        const clientSeed = newClientSeed();
        const ix = await getBuyPullInstructionAsync({
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
        <Card>
            <CardHeader>
                <CardTitle>Open a pack</CardTitle>
                <CardDescription>
                    Pay the entry fee to open a pull. Your wallet mixes 32 bytes of fresh entropy into the VRF input, so
                    the outcome can’t be known — even by the operator — until your buy lands.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button className="w-full" size="lg" onClick={() => void open()} disabled={isSending}>
                    <Dices /> {isSending ? 'Opening…' : `Open pack · ${formatSol(pool.pool.entryFee)} SOL`}
                </Button>
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" /> Provably fair · every reveal is verifiable off-chain
                </p>
            </CardContent>
        </Card>
    );
}
