'use client';

import { useSolanaClient, useTransactionPreparer } from '@solana/connector/react';
import {
    appendTransactionMessageInstructions,
    assertIsTransactionWithBlockhashLifetime,
    createTransactionMessage,
    getSignatureFromTransaction,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { useMemo } from 'react';

/**
 * Signs and sends one or more instructions with the connected wallet.
 *
 * `useTransactionPreparer` (from @solana/connector) attaches the latest blockhash, and
 * `client.rpc`/`client.rpcSubscriptions` (from `useSolanaClient`) point at the cluster the
 * wallet connector is configured for, so sending follows the user's cluster selection.
 */
export function useSendInstruction() {
    const { client } = useSolanaClient();
    const { prepare } = useTransactionPreparer();
    const sendAndConfirm = useMemo(
        () =>
            client
                ? sendAndConfirmTransactionFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions })
                : null,
        [client],
    );

    return async (ix: Instruction | Instruction[], feePayer: TransactionSigner): Promise<string> => {
        if (!sendAndConfirm) throw new Error('Solana client not ready');

        const instructions = Array.isArray(ix) ? ix : [ix];
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            tx => setTransactionMessageFeePayerSigner(feePayer, tx),
            tx => appendTransactionMessageInstructions(instructions, tx),
        );

        const prepared = await prepare(transactionMessage);
        const signedTransaction = await signTransactionMessageWithSigners(prepared);
        assertIsTransactionWithBlockhashLifetime(signedTransaction);
        await sendAndConfirm(signedTransaction, { commitment: 'confirmed' });
        return getSignatureFromTransaction(signedTransaction);
    };
}
