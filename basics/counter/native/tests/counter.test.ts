import { describe, test } from 'node:test';
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { COUNTER_ACCOUNT_SIZE, createIncrementInstruction, deserializeCounterAccount, PROGRAM_ID } from '../ts';

describe('Counter Solana Native', () => {
    // Load the program to litesvm
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/counter_solana_native.so');
    // Generate a payer keypair and fund it, this will be used to sign transactions with enough lamports
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
    // Get the rent object to calculate rent for the accounts
    const rent = svm.getRent();

    test('Test allocate counter + increment tx', () => {
        // Randomly generate the account key
        // to sign for setting up the Counter state
        const counterKeypair = Keypair.generate();
        const counter = counterKeypair.publicKey;

        // Create a TransactionInstruction to interact with our counter program
        const allocIx: TransactionInstruction = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: counter,
            lamports: Number(rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE))),
            space: COUNTER_ACCOUNT_SIZE,
            programId: PROGRAM_ID,
        });
        const incrementIx: TransactionInstruction = createIncrementInstruction({ counter });
        const tx = new Transaction().add(allocIx).add(incrementIx);

        // Explicitly set the feePayer to be our wallet (this is set to first signer by default)
        tx.feePayer = payer.publicKey;

        // Fetch a "timestamp" so validators know this is a recent transaction
        tx.recentBlockhash = svm.latestBlockhash();

        // Sign the transaction with the payer's keypair
        tx.sign(payer, counterKeypair);

        // Send transaction to litesvm
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        // Get the counter account info from network
        const counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo, 'Expected counter account to have been created');

        // Deserialize the counter & check count has been incremented
        const counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 1, 'Expected count to have been 1');
        console.log(`[alloc+increment] count is: ${counterAccount.count.toNumber()}`);
    });

    test('Test allocate tx and increment tx', () => {
        const counterKeypair = Keypair.generate();
        const counter = counterKeypair.publicKey;

        // Check allocate tx
        const allocIx: TransactionInstruction = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: counter,
            lamports: Number(rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE))),
            space: COUNTER_ACCOUNT_SIZE,
            programId: PROGRAM_ID,
        });
        let tx = new Transaction().add(allocIx);
        const blockhash = svm.latestBlockhash();
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(payer, counterKeypair);

        let result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        let counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo, 'Expected counter account to have been created');

        let counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 0, 'Expected count to have been 0');
        console.log(`[allocate] count is: ${counterAccount.count.toNumber()}`);

        // Check increment tx
        const incrementIx: TransactionInstruction = createIncrementInstruction({ counter });
        tx = new Transaction().add(incrementIx);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(payer);

        result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo, 'Expected counter account to have been created');

        counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 1, 'Expected count to have been 1');
        console.log(`[increment] count is: ${counterAccount.count.toNumber()}`);
    });
});
