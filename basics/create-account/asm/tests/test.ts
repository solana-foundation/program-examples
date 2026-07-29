import assert from 'node:assert';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Create a system account', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/create-account-asm-program.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(2 * LAMPORTS_PER_SOL));

    it('Create the account via a cross program invocation', () => {
        const newKeypair = Keypair.generate();

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: newKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, newKeypair);

        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const accountInfo = svm.getAccount(newKeypair.publicKey);
        assert.ok(accountInfo, 'new account should exist');
        assert.ok(accountInfo.lamports > 0, 'new account should have lamports');
        assert.equal(accountInfo.owner.toString(), SystemProgram.programId.toString());
    });

    it('Create the account via direct call to system program', () => {
        const newKeypair = Keypair.generate();

        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: newKeypair.publicKey,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programId: SystemProgram.programId,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, newKeypair);

        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const accountInfo = svm.getAccount(newKeypair.publicKey);
        assert.ok(accountInfo, 'new account should exist');
        assert.equal(accountInfo.lamports, LAMPORTS_PER_SOL);
        assert.equal(accountInfo.owner.toString(), SystemProgram.programId.toString());
    });
});
