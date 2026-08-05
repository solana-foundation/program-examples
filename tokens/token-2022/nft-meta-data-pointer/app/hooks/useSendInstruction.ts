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
import { rpc, rpcSubscriptions } from '@/utils/anchor';

export function useSendInstruction() {
    const sendAndConfirm = useMemo(() => sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions }), []);

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
        await sendAndConfirm(signedTransaction, { commitment: 'confirmed', skipPreflight: true });
        return getSignatureFromTransaction(signedTransaction);
    };
}
