import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('PDAs', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/program_derived_addresses_native_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const PageVisitsSchema = {
        struct: {
            page_visits: 'u32',
            bump: 'u8',
        },
    };

    // Empty struct — just needs to serialize to zero bytes
    const IncrementPageVisitsSchema = { struct: {} };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    function sendTransaction(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    const testUser = Keypair.generate();

    test('Create a test user', () => {
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            lamports: Number(svm.minimumBalanceForRentExemption(BigInt(0))),
            newAccountPubkey: testUser.publicKey,
            programId: SystemProgram.programId,
            space: 0,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, testUser); // Add instruction and Sign the transaction

        sendTransaction(tx);
        console.log(`Local Wallet: ${payer.publicKey}`);
        console.log(`Created User: ${testUser.publicKey}`);
    });

    function derivePageVisitsPda(userPubkey: PublicKey) {
        return PublicKey.findProgramAddressSync([Buffer.from('page_visits'), userPubkey.toBuffer()], PROGRAM_ID);
    }

    test('Create the page visits tracking PDA', () => {
        const [pageVisitsPda, pageVisitsBump] = derivePageVisitsPda(testUser.publicKey);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
                { pubkey: testUser.publicKey, isSigner: false, isWritable: false },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(PageVisitsSchema, {
                page_visits: 0,
                bump: pageVisitsBump,
            }),
        });
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);
    });

    test('Visit the page!', () => {
        const [pageVisitsPda, _] = derivePageVisitsPda(testUser.publicKey);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(IncrementPageVisitsSchema, {}),
        });
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);
    });

    test('Visit the page!', () => {
        const [pageVisitsPda, _] = derivePageVisitsPda(testUser.publicKey);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(IncrementPageVisitsSchema, {}),
        });
        const tx = new Transaction();
        svm.expireBlockhash();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);
    });

    test('Read page visits', () => {
        const [pageVisitsPda, _] = derivePageVisitsPda(testUser.publicKey);
        const accountInfo = svm.getAccount(pageVisitsPda);
        assert(accountInfo, 'page visits account not found');
        const readPageVisits = borsh.deserialize(PageVisitsSchema, Buffer.from(accountInfo.data)) as {
            page_visits: number;
            bump: number;
        };
        console.log(`Number of page visits: ${readPageVisits.page_visits}`);
    });
});
