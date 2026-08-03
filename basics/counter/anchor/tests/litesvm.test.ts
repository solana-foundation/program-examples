import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/counter_anchor.json' with { type: 'json' };

describe('LiteSVM: Counter', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    const coder = new anchor.BorshCoder(IDL as anchor.Idl);
    const programPath = new URL('../target/deploy/counter_anchor.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    /**
     * Generate a new keypair for the counter account
     */
    const counterKeypair = new Keypair();

    it('Initialize Counter', () => {
        /**
         * Instruction data
         * Create Transaction
         */
        const data = coder.instruction.encode('initialize_counter', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: counterKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, counterKeypair);
        svm.sendTransaction(tx);

        /**
         * Fetch counter account
         */
        const counterAccount = svm.getAccount(counterKeypair.publicKey);
        const counter = coder.accounts.decode('Counter', Buffer.from(counterAccount.data));

        assert.equal(counter.count, 0);
    });

    it('Increment Counter', () => {
        const data = coder.instruction.encode('increment', {});
        const ix = new TransactionInstruction({
            keys: [{ pubkey: counterKeypair.publicKey, isSigner: false, isWritable: true }],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);
        svm.expireBlockhash();

        /**
         * Fetch counter account
         */
        const counterAccount = svm.getAccount(counterKeypair.publicKey);
        const counter = coder.accounts.decode('Counter', Buffer.from(counterAccount.data));

        assert.equal(counter.count, 1);
    });

    it('Increment Counter Again', () => {
        const data = coder.instruction.encode('increment', {});
        const ix = new TransactionInstruction({
            keys: [{ pubkey: counterKeypair.publicKey, isSigner: false, isWritable: true }],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        /**
         * Fetch counter account
         */
        const counterAccount = svm.getAccount(counterKeypair.publicKey);
        const counter = coder.accounts.decode('Counter', Buffer.from(counterAccount.data));

        assert.equal(counter.count, 2);
    });
});
