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

const COUNTER_ACCOUNT_SIZE = 8;
const INCREMENT_DISCRIMINATOR = 0;

describe('Counter Solana Pinocchio', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/counter_solana_pinocchio.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const counterKeypair = Keypair.generate();
    const counter = counterKeypair.publicKey;

    function readCount(): bigint {
        const account = svm.getAccount(counter);
        assert(account, 'expected counter account to exist');
        assert.equal(account.data.length, COUNTER_ACCOUNT_SIZE);
        return Buffer.from(account.data).readBigUInt64LE(0);
    }

    it('Create the counter account', () => {
        const rent = svm.getRent();
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: counter,
            lamports: Number(rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE))),
            space: COUNTER_ACCOUNT_SIZE,
            programId: PROGRAM_ID,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, counterKeypair);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(readCount(), 0n);
    });

    it('Increment the counter', () => {
        const ix = new TransactionInstruction({
            keys: [{ pubkey: counter, isSigner: false, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.from([INCREMENT_DISCRIMINATOR]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(readCount(), 1n);
    });
});
