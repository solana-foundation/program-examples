import { findPullPda } from '@solana/gacha';
import {
    address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Address,
    type Instruction,
} from '@solana/kit';
import { Dices, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useWallet } from '@/hooks/use-wallet';
import type { PoolView } from '@/hooks/use-pool';
import { formatSol } from '@/lib/format';
import { newClientSeed } from '@/lib/gacha';
import { processPull, PullApiError } from '@/lib/pull-api';
import { useCluster } from '@/lib/cluster-context';

const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');

function computeUnitPriceInstruction(microLamports: bigint): Instruction {
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, microLamports, true);
    return { data, programAddress: COMPUTE_BUDGET_PROGRAM };
}

type BuyCardProps = {
    pool: PoolView;
    onOpened: (pull: Address) => void;
    onProcessing: (pull: Address) => void;
    onProcessingFailed: (pull: Address, submitted: boolean) => void;
};

export function BuyCard({ pool, onOpened, onProcessing, onProcessingFailed }: BuyCardProps) {
    const { address, client, signer } = useWallet();
    const { cluster } = useCluster();
    const [stage, setStage] = useState<'idle' | 'signing' | 'processing'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState<Readonly<{ buyer: Address; pull: Address; transaction: string }> | null>(null);

    async function process(transaction: string, buyer: Address, pull: Address) {
        setError(null);
        setStage('processing');
        onProcessing(pull);
        try {
            await processPull(buyer, transaction);
            setRetry(null);
            onOpened(pull);
        } catch (cause) {
            const submitted = cause instanceof PullApiError && Boolean(cause.failure.buySignature);
            if (cause instanceof PullApiError && cause.failure.retryable && submitted) {
                setRetry({ buyer, pull, transaction });
            }
            onProcessingFailed(pull, submitted);
            setError(cause instanceof PullApiError ? cause.failure.message : 'The pull could not be completed.');
        } finally {
            setStage('idle');
        }
    }

    async function open() {
        if (!signer || !address || cluster !== 'devnet') return;
        setError(null);
        setRetry(null);
        setStage('signing');
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
        try {
            const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
            const message = pipe(
                createTransactionMessage({ version: 0 }),
                message => setTransactionMessageFeePayerSigner(signer, message),
                message => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
                message => appendTransactionMessageInstructions([computeUnitPriceInstruction(1_000n), ix], message),
            );
            const signed = await signTransactionMessageWithSigners(message);
            await process(getBase64EncodedWireTransaction(signed), address, pull);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The pull could not be signed.');
        } finally {
            if (stage !== 'processing') setStage('idle');
        }
    }

    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="grid md:grid-cols-[minmax(240px,0.8fr)_minmax(320px,1fr)]">
                <div className="flex min-h-[390px] items-center justify-center bg-secondary/40 p-8">
                    <div className="w-full max-w-[220px] overflow-hidden rounded-xl border bg-secondary shadow-xl">
                        <img
                            src="/cards/simd/simd-all-stars-pack.jpg"
                            alt="A sealed SIMD All-Stars trading-card pack with visible crimped edges"
                            className="aspect-[2/3] h-auto w-full object-cover"
                        />
                    </div>
                </div>
                <div className="flex flex-col justify-center">
                    <CardHeader className="pb-4">
                        <p className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
                            First edition
                        </p>
                        <CardTitle className="text-balance text-3xl">SIMD All-Stars</CardTitle>
                        <CardDescription className="max-w-lg text-pretty leading-relaxed">
                            One proposal-inspired character per pack. Your wallet mixes fresh entropy into the VRF
                            input, so nobody knows the rarity before your buy lands.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pb-8">
                        <Button
                            className="w-full"
                            size="lg"
                            onClick={() => void open()}
                            disabled={stage !== 'idle' || cluster !== 'devnet'}
                        >
                            <Dices />
                            {stage === 'signing'
                                ? 'Approve in wallet…'
                                : stage === 'processing'
                                  ? 'Revealing and minting…'
                                  : `Open one pack · ${formatSol(pool.pool.entryFee)} SOL`}
                        </Button>
                        {cluster !== 'devnet' && (
                            <p className="text-sm text-muted-foreground">
                                Automated reveal and mint is currently devnet-only.
                            </p>
                        )}
                        {error && (
                            <p className="text-sm text-destructive" role="alert">
                                {error}
                            </p>
                        )}
                        {retry && (
                            <Button
                                className="w-full"
                                variant="outline"
                                onClick={() => void process(retry.transaction, retry.buyer, retry.pull)}
                                disabled={stage !== 'idle'}
                            >
                                Retry reveal and mint
                            </Button>
                        )}
                        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                            <ShieldCheck className="size-3.5" aria-hidden="true" /> Provably fair · every pull is
                            independently verifiable
                        </p>
                    </CardContent>
                </div>
            </div>
        </Card>
    );
}
