import { Buffer } from 'node:buffer';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Realloc!', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/realloc_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const testAccount = Keypair.generate();

    function fixedString(value: string): Buffer {
        const bytes = Buffer.alloc(8);
        bytes.write(value, 0, 8, 'utf8');
        return bytes;
    }

    function readFixedString(data: Uint8Array, offset: number): string {
        return Buffer.from(data.slice(offset, offset + 8))
            .toString('utf8')
            .replace(/\0+$/, '');
    }

    function sendTransaction(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    function getTestAccountData(): Uint8Array {
        const account = svm.getAccount(testAccount.publicKey);
        assert(account, 'test account not found');
        return account.data;
    }

    it('Create the account with data', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: testAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.concat([
                Buffer.from([0]),
                fixedString('Jacob'),
                Buffer.from([123]),
                fixedString('Main St.'),
                fixedString('Chicago'),
            ]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, testAccount);
        sendTransaction(tx);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);
        assert.strictEqual(readFixedString(data, 0), 'Jacob');
        assert.strictEqual(data[8], 123);
        assert.strictEqual(readFixedString(data, 9), 'Main St.');
        assert.strictEqual(readFixedString(data, 17), 'Chicago');
    });

    it('Reallocate WITHOUT zero init', () => {
        const zip = Buffer.alloc(4);
        zip.writeUInt32LE(12345, 0);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: testAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.concat([Buffer.from([1]), fixedString('Illinois'), zip]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);
        sendTransaction(tx);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 37);
        assert.strictEqual(readFixedString(data, 0), 'Jacob');
        assert.strictEqual(readFixedString(data, 25), 'Illinois');
        assert.strictEqual(Buffer.from(data).readUInt32LE(33), 12345);
    });

    it('Reallocate WITH zero init', () => {
        const ix = new TransactionInstruction({
            keys: [{ pubkey: testAccount.publicKey, isSigner: false, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.concat([
                Buffer.from([2]),
                fixedString('Perelyn'),
                fixedString('Eng'),
                fixedString('Anza'),
                Buffer.from([2]),
            ]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);
        sendTransaction(tx);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);
        assert.strictEqual(readFixedString(data, 0), 'Perelyn');
        assert.strictEqual(readFixedString(data, 8), 'Eng');
        assert.strictEqual(readFixedString(data, 16), 'Anza');
        assert.strictEqual(data[24], 2);
    });
});
