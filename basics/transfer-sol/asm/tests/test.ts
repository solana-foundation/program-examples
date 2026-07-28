import assert from 'node:assert';
import { describe, test } from 'node:test';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { start } from 'solana-bankrun';
import { createTransferInstruction } from './instruction';

describe('transfer-sol (asm)', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'transfer-sol-cpi', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    const transferAmount = 1 * LAMPORTS_PER_SOL;
    const recipient = Keypair.generate();

    test('Transfer SOL via CPI to the system program', async () => {
        const [payerBefore, recipientBefore] = await getBalances(payer.publicKey, recipient.publicKey, 'Beginning');

        const ix = createTransferInstruction(payer.publicKey, recipient.publicKey, PROGRAM_ID, transferAmount);

        const tx = new Transaction();
        const [blockhash, _] = await client.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        await client.processTransaction(tx);

        const [payerAfter, recipientAfter] = await getBalances(payer.publicKey, recipient.publicKey, 'Resulting');

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

    async function getBalances(
        payerPubkey: PublicKey,
        recipientPubkey: PublicKey,
        timeframe: string,
    ): Promise<[bigint, bigint]> {
        const payerBalance = await client.getBalance(payerPubkey);
        const recipientBalance = await client.getBalance(recipientPubkey);

        console.log(`${timeframe} balances:`);
        console.log(`   Payer: ${payerBalance}`);
        console.log(`   Recipient: ${recipientBalance}`);

        return [payerBalance, recipientBalance];
    }
});
