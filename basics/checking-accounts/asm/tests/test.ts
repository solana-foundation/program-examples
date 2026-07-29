import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Checking accounts', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/checking-account-asm-program.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const rentExemptBalance = svm.minimumBalanceForRentExemption(BigInt(0));

    function sendExpectSuccess(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    function sendExpectCustomError(tx: Transaction, code: number) {
        const result = svm.sendTransaction(tx);
        assert.ok(result instanceof FailedTransactionMetadata, 'expected transaction to fail');
        assert.equal(
            result.err().toString(),
            `TransactionErrorInstructionError { index: 0, error: InstructionErrorCustom { code: ${code} } }`,
        );
    }

    // We'll create this ahead of time.
    // Our program will try to modify it.
    const accountToChange = Keypair.generate();
    // Our program will create this.
    const accountToCreate = Keypair.generate();

    test('Create an account owned by our program', () => {
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: accountToChange.publicKey,
            lamports: Number(rentExemptBalance),
            space: 0,
            programId: PROGRAM_ID, // Our program
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, accountToChange);

        sendExpectSuccess(tx);
    });

    test('Check accounts', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: accountToCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: accountToChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, accountToChange, accountToCreate);

        sendExpectSuccess(tx);
    });

    test('Invalid number of accounts (error 1)', () => {
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendExpectCustomError(tx, 1);
    });

    test('Payer not signer (error 2)', () => {
        const feePayer = Keypair.generate();
        const fakePayer = Keypair.generate();
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();

        const fund = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: feePayer.publicKey,
            lamports: 10_000_000,
        });
        const fundTx = new Transaction();
        fundTx.recentBlockhash = svm.latestBlockhash();
        fundTx.add(fund).sign(payer);
        sendExpectSuccess(fundTx);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: fakePayer.publicKey, isSigner: false, isWritable: true }, // not a signer
                { pubkey: acCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: acChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(feePayer, acCreate, acChange);

        sendExpectCustomError(tx, 2);
    });

    test('Account to create already initialized (error 3)', () => {
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();

        // Fund acCreate so it appears initialized
        const fund = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: acCreate.publicKey,
            lamports: 1_000_000,
        });
        // Fund acChange so it is initialized and owned by our program
        const fundChange = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: acChange.publicKey,
            lamports: Number(rentExemptBalance),
            space: 0,
            programId: PROGRAM_ID,
        });

        const setupTx = new Transaction();
        setupTx.recentBlockhash = svm.latestBlockhash();
        setupTx.add(fund, fundChange).sign(payer, acChange);
        sendExpectSuccess(setupTx);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: acCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: acChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, acCreate, acChange);

        sendExpectCustomError(tx, 3);
    });

    test('Account to change not initialized (error 4)', () => {
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate(); // no lamports

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: acCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: acChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, acCreate, acChange);

        sendExpectCustomError(tx, 4);
    });

    test('Invalid system program (error 5)', () => {
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();
        const fakeSystemProgram = PublicKey.unique();

        const fund = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: acChange.publicKey,
            lamports: Number(rentExemptBalance),
            space: 0,
            programId: PROGRAM_ID,
        });
        const setupTx = new Transaction();
        setupTx.recentBlockhash = svm.latestBlockhash();
        setupTx.add(fund).sign(payer, acChange);
        sendExpectSuccess(setupTx);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: acCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: acChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: fakeSystemProgram, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, acCreate, acChange);

        sendExpectCustomError(tx, 5);
    });

    test('Account to change wrong owner (error 6)', () => {
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();

        // Fund acChange but keep it owned by the system program (no createAccount with PROGRAM_ID)
        const fund = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: acChange.publicKey,
            lamports: 1_000_000,
        });
        const setupTx = new Transaction();
        setupTx.recentBlockhash = svm.latestBlockhash();
        setupTx.add(fund).sign(payer);
        sendExpectSuccess(setupTx);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: acCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: acChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, acCreate, acChange);

        sendExpectCustomError(tx, 6);
    });
});
