import type { Instruction } from '@solana/kit';
import {
    appendTransactionMessageInstructions,
    assertIsTransactionWithBlockhashLifetime,
    createTransactionMessage,
    estimateAndSetResourceLimitsFactory,
    estimateResourceLimitsFactory,
    getSignatureFromTransaction,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useCluster } from '@/lib/cluster-context';
import { parseTransactionError } from '@/lib/errors';
import { useWallet } from './use-wallet';

/**
 * Builds, signs, and confirms a transaction from raw instructions using the
 * connected wallet as fee payer + signer. Compute limits are sized from a
 * simulation with a small headroom so claim's ~10-CPI mint does not run at the
 * bare estimate.
 */
export function useSend() {
    const { client, connected } = useWallet();
    const { getExplorerUrl } = useCluster();
    const [isSending, setIsSending] = useState(false);

    const signAndSend = useCallback(
        async (instructions: Instruction | Instruction[]): Promise<string> => {
            const signer = connected?.signer;
            if (!signer) throw new Error('Connect your wallet first.');

            const rpc = client.rpc;
            const ixs = Array.isArray(instructions) ? instructions : [instructions];
            const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

            const message = pipe(
                createTransactionMessage({ version: 0 }),
                tx => setTransactionMessageFeePayerSigner(signer, tx),
                tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
                tx => appendTransactionMessageInstructions(ixs, tx),
            );

            const estimate = estimateResourceLimitsFactory({ rpc });
            const setLimits = estimateAndSetResourceLimitsFactory(async (msg, config) => {
                const limits = await estimate(msg, config);
                return {
                    ...limits,
                    computeUnitLimit: Math.min(1_400_000, Math.ceil(limits.computeUnitLimit * 1.1) + 300),
                };
            });
            const withLimits = await setLimits(message);

            const signed = await signTransactionMessageWithSigners(withLimits);
            assertIsTransactionWithBlockhashLifetime(signed);
            const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: client.rpcSubscriptions });
            await sendAndConfirm(signed, { commitment: 'confirmed' });
            return getSignatureFromTransaction(signed);
        },
        [client, connected],
    );

    const run = useCallback(
        async (instructions: Instruction | Instruction[], successMessage: string): Promise<string | undefined> => {
            setIsSending(true);
            try {
                const signature = await signAndSend(instructions);
                toast.success(successMessage, {
                    description: (
                        <a
                            href={getExplorerUrl(`/tx/${signature}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                        >
                            View transaction
                        </a>
                    ),
                });
                return signature;
            } catch (err) {
                console.error(err);
                toast.error(parseTransactionError(err));
                return undefined;
            } finally {
                setIsSending(false);
            }
        },
        [signAndSend, getExplorerUrl],
    );

    return { run, isSending };
}
