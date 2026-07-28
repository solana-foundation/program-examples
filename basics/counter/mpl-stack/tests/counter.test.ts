import type { bignum } from '@metaplex-foundation/beet';
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    sendAndConfirmTransaction,
    Transaction,
    type TransactionInstruction,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import { assert } from 'chai';

import { Counter, createIncrementInstruction, PROGRAM_ID } from '../ts';

function convertBignumToNumber(bignum: bignum): number {
    return new BN(bignum).toNumber();
}

describe('Counter Solana Native', () => {
    const connection = new Connection('http://localhost:8899');

    it('Test allocate counter + increment tx', async () => {
        // Randomly generate our wallet
        const payerKeypair = Keypair.generate();
        const payer = payerKeypair.publicKey;

        // Randomly generate the account key
        // to sign for setting up the Counter state
        const counterKeypair = Keypair.generate();
        const counter = counterKeypair.publicKey;

        // Airdrop our wallet 1 Sol
        await connection.requestAirdrop(payer, LAMPORTS_PER_SOL);

        // Create a TransactionInstruction to interact with our counter program
        const allocIx: TransactionInstruction = SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: counter,
            lamports: await connection.getMinimumBalanceForRentExemption(Counter.byteSize),
            space: Counter.byteSize,
            programId: PROGRAM_ID,
        });
        const incrementIx: TransactionInstruction = createIncrementInstruction({
            counter,
        });
        const tx = new Transaction().add(allocIx).add(incrementIx);

        // Explicitly set the feePayer to be our wallet (this is set to first signer by default)
        tx.feePayer = payer;

        // Fetch a "timestamp" so validators know this is a recent transaction
        tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

        // Send transaction to network (local network)
        await sendAndConfirmTransaction(connection, tx, [payerKeypair, counterKeypair], {
            skipPreflight: true,
            commitment: 'confirmed',
        });

        // Get the counter account info from network
        const count = (await Counter.fromAccountAddress(connection, counter)).count;
        assert(new BN(count).toNumber() === 1, 'Expected count to have been 1');
        console.log(`[alloc+increment] count is: ${count}`);
    });
    it('Test allocate tx and increment tx', async () => {
        const payerKeypair = Keypair.generate();
        const payer = payerKeypair.publicKey;

        const counterKeypair = Keypair.generate();
        const counter = counterKeypair.publicKey;

        await connection.requestAirdrop(payer, LAMPORTS_PER_SOL);

        // Check allocate tx
        const allocIx: TransactionInstruction = SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: counter,
            lamports: await connection.getMinimumBalanceForRentExemption(Counter.byteSize),
            space: Counter.byteSize,
            programId: PROGRAM_ID,
        });
        let tx = new Transaction().add(allocIx);
        tx.feePayer = payer;
        tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
        await sendAndConfirmTransaction(connection, tx, [payerKeypair, counterKeypair], {
            skipPreflight: true,
            commitment: 'confirmed',
        });

        let count = (await Counter.fromAccountAddress(connection, counter)).count;
        assert(convertBignumToNumber(count) === 0, 'Expected count to have been 0');
        console.log(`[allocate] count is: ${count}`);

        // Check increment tx
        const incrementIx: TransactionInstruction = createIncrementInstruction({
            counter,
        });
        tx = new Transaction().add(incrementIx);
        tx.feePayer = payer;
        tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
        await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
            skipPreflight: true,
            commitment: 'confirmed',
        });

        count = (await Counter.fromAccountAddress(connection, counter)).count;
        assert(convertBignumToNumber(count) === 1, 'Expected count to have been 1');
        console.log(`[increment] count is: ${count}`);
    });
});
