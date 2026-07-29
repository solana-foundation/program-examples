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

describe('Pinocchio: CPI', () => {
    const HAND_PROGRAM_ID = PublicKey.unique();
    const LEVER_PROGRAM_ID = PublicKey.unique();

    const svm = new LiteSVM();
    svm.addProgramFromFile(HAND_PROGRAM_ID, 'tests/fixtures/cross_program_invocation_pinocchio_hand.so');
    svm.addProgramFromFile(LEVER_PROGRAM_ID, 'tests/fixtures/cross_program_invocation_pinocchio_lever.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Lever instruction discriminator
    const IX_INITIALIZE = 0;

    const powerAccount = Keypair.generate();

    function sendTx(ix: TransactionInstruction, signers: Keypair[]) {
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, ...signers);
        return svm.sendTransaction(tx);
    }

    it('Initialize the lever!', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: LEVER_PROGRAM_ID,
            data: Buffer.from([IX_INITIALIZE]),
        });
        const result = sendTx(ix, [powerAccount]);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.publicKey);
        if (acct === null) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false
    });

    it('Pull the lever!', () => {
        const name = 'Chris';
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            programId: HAND_PROGRAM_ID,
            data: Buffer.from(name, 'utf8'),
        });
        const result = sendTx(ix, []);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.publicKey);
        if (acct === null) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([1])); // is_on = true
    });

    it('Pull it again!', () => {
        const name = 'Ashley';
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            programId: HAND_PROGRAM_ID,
            data: Buffer.from(name, 'utf8'),
        });
        const result = sendTx(ix, []);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.publicKey);
        if (acct === null) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false (flipped back)
    });

    it('Lever rejects switch_power directly with no name', () => {
        // Sending only the discriminator (no name bytes) is fine because UTF-8 of empty is empty,
        // but invoking the lever directly with an unknown discriminator should fail.
        const ix = new TransactionInstruction({
            keys: [{ pubkey: powerAccount.publicKey, isSigner: false, isWritable: true }],
            programId: LEVER_PROGRAM_ID,
            data: Buffer.from([42]),
        });

        const result = sendTx(ix, []);
        assert.instanceOf(result, FailedTransactionMetadata, 'expected lever to reject unknown discriminator');
    });
});
