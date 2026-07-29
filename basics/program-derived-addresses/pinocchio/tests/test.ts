import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('PDAs', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/program_derived_addresses_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10) * BigInt(LAMPORTS_PER_SOL));

    const testUser = Keypair.generate();
    const [pageVisitsPda, pageVisitsBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('page_visits'), testUser.publicKey.toBuffer()],
        PROGRAM_ID,
    );

    function sendTransaction(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    function readPageVisits(): number {
        const account = svm.getAccount(pageVisitsPda);
        assert(account, 'page visits account not found');
        return Buffer.from(account.data).readUInt32LE(0);
    }

    function incrementInstruction(): TransactionInstruction {
        return new TransactionInstruction({
            keys: [{ pubkey: pageVisitsPda, isSigner: false, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.from([1]),
        });
    }

    it('Create a test user', () => {
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            lamports: Number(svm.minimumBalanceForRentExemption(BigInt(0))),
            newAccountPubkey: testUser.publicKey,
            programId: SystemProgram.programId,
            space: 0,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, testUser);

        sendTransaction(tx);
    });

    it('Create the page visits tracking PDA', () => {
        const data = Buffer.alloc(6);
        data.writeUInt8(0, 0);
        data.writeUInt32LE(0, 1);
        data.writeUInt8(pageVisitsBump, 5);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
                { pubkey: testUser.publicKey, isSigner: false, isWritable: false },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);

        const account = svm.getAccount(pageVisitsPda);
        assert(account, 'page visits account not found');
        assert.strictEqual(account.owner.toBase58(), PROGRAM_ID.toBase58());
        assert.strictEqual(account.data.length, 5);
        assert.strictEqual(readPageVisits(), 0);
    });

    it('Visit the page!', () => {
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(incrementInstruction()).sign(payer);

        sendTransaction(tx);

        assert.strictEqual(readPageVisits(), 1);
    });

    it('Visit the page again!', () => {
        svm.expireBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(incrementInstruction()).sign(payer);

        sendTransaction(tx);

        assert.strictEqual(readPageVisits(), 2);
    });
});
