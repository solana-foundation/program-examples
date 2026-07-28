import assert from 'node:assert';
import { describe, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { start } from 'solana-bankrun';

describe('Checking accounts', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'checking-account-asm-program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;
    const rent = await client.getRent();

    // We'll create this ahead of time.
    // Our program will try to modify it.
    const accountToChange = Keypair.generate();
    // Our program will create this.
    const accountToCreate = Keypair.generate();

    test('Create an account owned by our program', async () => {
        const blockhash = context.lastBlockhash;
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: accountToChange.publicKey,
            lamports: Number(rent.minimumBalance(BigInt(0))),
            space: 0,
            programId: PROGRAM_ID, // Our program
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, accountToChange);

        await client.processTransaction(tx);
    });

    test('Check accounts', async () => {
        const blockhash = context.lastBlockhash;
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
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, accountToChange, accountToCreate);

        await client.processTransaction(tx);
    });

    test('Invalid number of accounts (error 1)', async () => {
        const blockhash = context.lastBlockhash;
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x1');
    });

    test('Payer not signer (error 2)', async () => {
        const blockhash = context.lastBlockhash;
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
        fundTx.recentBlockhash = blockhash;
        fundTx.add(fund).sign(payer);
        await client.processTransaction(fundTx);

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
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(feePayer, acCreate, acChange);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x2');
    });

    test('Account to create already initialized (error 3)', async () => {
        const blockhash = context.lastBlockhash;
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
            lamports: Number(rent.minimumBalance(BigInt(0))),
            space: 0,
            programId: PROGRAM_ID,
        });

        const setupTx = new Transaction();
        setupTx.recentBlockhash = blockhash;
        setupTx.add(fund, fundChange).sign(payer, acChange);
        await client.processTransaction(setupTx);

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
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(payer, acCreate, acChange);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x3');
    });

    test('Account to change not initialized (error 4)', async () => {
        const blockhash = context.lastBlockhash;
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
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, acCreate, acChange);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x4');
    });

    test('Invalid system program (error 5)', async () => {
        const blockhash = context.lastBlockhash;
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();
        const fakeSystemProgram = PublicKey.unique();

        const fund = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: acChange.publicKey,
            lamports: Number(rent.minimumBalance(BigInt(0))),
            space: 0,
            programId: PROGRAM_ID,
        });
        const setupTx = new Transaction();
        setupTx.recentBlockhash = blockhash;
        setupTx.add(fund).sign(payer, acChange);
        await client.processTransaction(setupTx);

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
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(payer, acCreate, acChange);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x5');
    });

    test('Account to change wrong owner (error 6)', async () => {
        const blockhash = context.lastBlockhash;
        const acCreate = Keypair.generate();
        const acChange = Keypair.generate();

        // Fund acChange but keep it owned by the system program (no createAccount with PROGRAM_ID)
        const fund = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: acChange.publicKey,
            lamports: 1_000_000,
        });
        const setupTx = new Transaction();
        setupTx.recentBlockhash = blockhash;
        setupTx.add(fund).sign(payer);
        await client.processTransaction(setupTx);

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
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(payer, acCreate, acChange);

        const res = await client.tryProcessTransaction(tx);
        assert.equal(res.result, 'Error processing Instruction 0: custom program error: 0x6');
    });
});
