'use client';

import {
    appendTransactionMessageInstructions,
    assertIsTransactionWithBlockhashLifetime,
    createTransactionMessage,
    getSignatureFromTransaction,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { useMemo } from 'react';
import { useClusterRpc } from '@/components/cluster/cluster-data-access';

/**
 * Signs and sends one or more instructions with the connected wallet, reading the RPC
 * (and its websocket subscriptions) from the active cluster so it moves with whatever
 * cluster the user has selected.
 */
export function useSendInstruction() {
    const { rpc, rpcSubscriptions } = useClusterRpc();
    const sendAndConfirm = useMemo(
        () => sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions }),
        [rpc, rpcSubscriptions],
    );

    return async (ix: Instruction | Instruction[], feePayer: TransactionSigner): Promise<string> => {
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
        const instructions = Array.isArray(ix) ? ix : [ix];

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            tx => setTransactionMessageFeePayerSigner(feePayer, tx),
            tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
            tx => appendTransactionMessageInstructions(instructions, tx),
        );

        const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
        assertIsTransactionWithBlockhashLifetime(signedTransaction);
        await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signedTransaction);
    };
}
