import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/anchor_realloc.json' with { type: 'json' };

describe('LiteSVM: realloc', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const coder = new anchor.BorshCoder(IDL as anchor.Idl);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    const programPath = new URL('../target/deploy/anchor_realloc.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    // PDA for the message account
    const messageAccount = new Keypair();

    it('Is initialized!', () => {
        const message = 'hello';
        const data = coder.instruction.encode('initialize', {
            input: message,
        });
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: messageAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, messageAccount);
        svm.sendTransaction(tx);

        //Fetch the message account and check it message
        const messageAccInfo = svm.getAccount(messageAccount.publicKey);
        const messageAcc = coder.accounts.decode('Message', Buffer.from(messageAccInfo.data));
        assert.equal(messageAccInfo.data.length, 8 + 4 + message.length);
        assert.equal(messageAcc.message, message);
    });

    it('Update', () => {
        const message = 'hello world';
        const data = coder.instruction.encode('update', {
            input: message,
        });
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: messageAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);
        svm.expireBlockhash();

        //Fetch the message account and check it message
        const messageAccInfo = svm.getAccount(messageAccount.publicKey);
        const messageAcc = coder.accounts.decode('Message', Buffer.from(messageAccInfo.data));
        assert.equal(messageAccInfo.data.length, 8 + 4 + message.length);
        assert.equal(messageAcc.message, message);
    });

    it('Again update', () => {
        const message = 'hi';
        const data = coder.instruction.encode('update', {
            input: message,
        });
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: messageAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);
        svm.expireBlockhash();

        //Fetch the message account and check it message
        const messageAccInfo = svm.getAccount(messageAccount.publicKey);
        const messageAcc = coder.accounts.decode('Message', Buffer.from(messageAccInfo.data));

        assert.equal(messageAccInfo.data.length, 8 + 4 + message.length);
        assert.equal(messageAcc.message, message);
    });
});
