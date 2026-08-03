import assert from 'node:assert';
import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createTransferInstruction } from './instruction';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('transfer-sol (asm)', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let recipient: KeyPairSigner;

    const transferAmount = 1n * LAMPORTS_PER_SOL;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/transfer-sol-cpi.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(2n * LAMPORTS_PER_SOL));
        recipient = await generateKeyPairSigner();
    });

    it('Transfer SOL via CPI to the system program', async () => {
        const [payerBefore, recipientBefore] = getBalances(payer.address, recipient.address, 'Beginning');

        const ix = createTransferInstruction(payer, recipient.address, programId, transferAmount);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const [payerAfter, recipientAfter] = getBalances(payer.address, recipient.address, 'Resulting');

        assert(
            payerAfter < payerBefore - transferAmount,
            'Payer balance should decrease by at least the transfer amount',
        );
        assert.strictEqual(
            recipientAfter,
            recipientBefore + transferAmount,
            'Recipient balance should increase by exactly the transfer amount',
        );
    });

    function getBalances(payerAddress: Address, recipientAddress: Address, timeframe: string): [bigint, bigint] {
        const payerBalance = svm.getBalance(payerAddress) ?? BigInt(0);
        const recipientBalance = svm.getBalance(recipientAddress) ?? BigInt(0);

        console.log(`${timeframe} balances:`);
        console.log(`   Payer: ${payerBalance}`);
        console.log(`   Recipient: ${recipientBalance}`);

        return [payerBalance, recipientBalance];
    }
});
