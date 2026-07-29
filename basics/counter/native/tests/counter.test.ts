import { Buffer } from 'node:buffer';
import {
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { COUNTER_ACCOUNT_SIZE, createIncrementInstruction, deserializeCounterAccount, PROGRAM_ID } from '../ts';

describe('Counter Solana Native', () => {
    // Load the program to litesvm
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/counter_solana_native.so');
    // Get the rent object to calculate rent for the accounts
    const rent = svm.getRent();
    // Generate a payer keypair and fund it, this will be used to sign transactions with enough lamports
    let payer: KeyPairSigner;

    before(async () => {
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    it('Test allocate counter + increment tx', async () => {
        // Randomly generate the account key
        // to sign for setting up the Counter state
        const counterKeypair = await generateKeyPairSigner();
        const counter = counterKeypair.address;

        // Create an instruction to interact with our counter program
        const allocIx = getCreateAccountInstruction({
            payer,
            newAccount: counterKeypair,
            lamports: rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE)),
            space: COUNTER_ACCOUNT_SIZE,
            programAddress: PROGRAM_ID,
        });
        const incrementIx = createIncrementInstruction({ counter });

        // Build the transaction message with our wallet as fee payer
        // and a recent blockhash so validators know this is a recent transaction
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions([allocIx, incrementIx], m),
        );

        // Sign the transaction with all required signers
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        // Send transaction to litesvm
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        // Get the counter account info from network
        const counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo.exists, 'Expected counter account to have been created');

        // Deserialize the counter & check count has been incremented
        const counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 1, 'Expected count to have been 1');
        console.log(`[alloc+increment] count is: ${counterAccount.count.toNumber()}`);
    });

    it('Test allocate tx and increment tx', async () => {
        const counterKeypair = await generateKeyPairSigner();
        const counter = counterKeypair.address;

        // Check allocate tx
        const allocIx = getCreateAccountInstruction({
            payer,
            newAccount: counterKeypair,
            lamports: rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE)),
            space: COUNTER_ACCOUNT_SIZE,
            programAddress: PROGRAM_ID,
        });
        const allocTransactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(allocIx, m),
        );
        const signedAllocTx = await signTransactionMessageWithSigners(allocTransactionMessage);

        let result = svm.sendTransaction(signedAllocTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        let counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo.exists, 'Expected counter account to have been created');

        let counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 0, 'Expected count to have been 0');
        console.log(`[allocate] count is: ${counterAccount.count.toNumber()}`);

        // Check increment tx
        const incrementIx = createIncrementInstruction({ counter });
        const incrementTransactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(incrementIx, m),
        );
        const signedIncrementTx = await signTransactionMessageWithSigners(incrementTransactionMessage);

        result = svm.sendTransaction(signedIncrementTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        counterAccountInfo = svm.getAccount(counter);
        assert(counterAccountInfo.exists, 'Expected counter account to have been created');

        counterAccount = deserializeCounterAccount(Buffer.from(counterAccountInfo.data));
        assert(counterAccount.count.toNumber() === 1, 'Expected count to have been 1');
        console.log(`[increment] count is: ${counterAccount.count.toNumber()}`);
    });
});
