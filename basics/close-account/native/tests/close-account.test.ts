import { describe, test } from 'node:test';
import { PublicKey, Transaction } from '@solana/web3.js';
import { start } from 'solana-bankrun';
import { createCloseUserInstruction, createCreateUserInstruction } from '../ts';

describe('Close Account!', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'close_account_native_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    const testAccountPublicKey = PublicKey.findProgramAddressSync(
        [Buffer.from('USER'), payer.publicKey.toBuffer()],
        PROGRAM_ID,
    )[0];

    test('Create the account', async () => {
        const blockhash = context.lastBlockhash;
        const ix = createCreateUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID, 'Jacob');

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        await client.processTransaction(tx);
    });

    test('Close the account', async () => {
        const blockhash = context.lastBlockhash;

        const ix = createCloseUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID);
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        await client.processTransaction(tx);
    });
});
