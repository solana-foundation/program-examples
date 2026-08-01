import type { Instruction } from '@solana/kit';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useCluster } from '@/lib/cluster-context';
import { parseTransactionError } from '@/lib/errors';
import { useWallet } from './use-wallet';

/**
 * Builds, signs, and confirms a transaction from raw instructions using the
 * connected wallet as fee payer + signer, then surfaces a toast with an explorer
 * link. The client's transaction planner sizes compute limits from a simulation
 * with headroom, so the claim path's ~10-CPI mint is not run at the bare estimate.
 */
export function useSend() {
    const { client, connected } = useWallet();
    const { getExplorerUrl } = useCluster();
    const [isSending, setIsSending] = useState(false);

    const run = useCallback(
        async (instructions: Instruction | Instruction[], successMessage: string): Promise<string | undefined> => {
            if (!connected?.signer) {
                toast.error('Connect your wallet first.');
                return undefined;
            }
            setIsSending(true);
            try {
                const { context } = await client.sendTransaction(instructions);
                toast.success(successMessage, {
                    description: (
                        <a
                            href={getExplorerUrl(`/tx/${context.signature}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                        >
                            View transaction
                        </a>
                    ),
                });
                return context.signature;
            } catch (err) {
                console.error(err);
                toast.error(parseTransactionError(err));
                return undefined;
            } finally {
                setIsSending(false);
            }
        },
        [client, connected, getExplorerUrl],
    );

    return { run, isSending };
}
