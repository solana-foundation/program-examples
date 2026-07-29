import assert from 'node:assert';
import { describe, test } from 'node:test';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createTransferInstruction } from './instruction';

describe('transfer-sol (asm)', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/transfer-sol-cpi.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(2 * LAMPORTS_PER_SOL));

    const transferAmount = 1 * LAMPORTS_PER_SOL;
    const recipient = Keypair.generate();

    test('Transfer SOL via CPI to the system program', () => {
        const [payerBefore, recipientBefore] = getBalances(payer.publicKey, recipient.publicKey, 'Beginning');

        const ix = createTransferInstruction(payer.publicKey, recipient.publicKey, PROGRAM_ID, transferAmount);

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const [payerAfter, recipientAfter] = getBalances(payer.publicKey, recipient.publicKey, 'Resulting');

        assert(
            payerAfter < payerBefore - BigInt(transferAmount),
            'Payer balance should decrease by at least the transfer amount',
        );
        assert.strictEqual(
            recipientAfter,
            recipientBefore + BigInt(transferAmount),
            'Recipient balance should increase by exactly the transfer amount',
        );
    });

    function getBalances(payerPubkey: PublicKey, recipientPubkey: PublicKey, timeframe: string): [bigint, bigint] {
        const payerBalance = svm.getBalance(payerPubkey) ?? BigInt(0);
        const recipientBalance = svm.getBalance(recipientPubkey) ?? BigInt(0);

        console.log(`${timeframe} balances:`);
        console.log(`   Payer: ${payerBalance}`);
        console.log(`   Recipient: ${recipientBalance}`);

        return [payerBalance, recipientBalance];
    }
});
