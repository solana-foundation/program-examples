import anchor from '@anchor-lang/core';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import Idl from '../target/idl/transfer_sol.json' with { type: 'json' };

describe('LiteSVM: Transfer SOL', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(Idl.address);
    const coder = new anchor.BorshCoder(Idl as anchor.Idl);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    const programFilePath = new URL('../target/deploy/transfer_sol.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programFilePath);

    it('Transfer SOL with CPI', () => {
        const recipient = Keypair.generate();

        const ixArgs = {
            amount: new anchor.BN(LAMPORTS_PER_SOL),
        };
        const data = coder.instruction.encode('transfer_sol_with_cpi', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: recipient.publicKey, isSigner: false, isWritable: true },
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

        const recipientAcc = svm.getAccount(recipient.publicKey);
        assert.equal(recipientAcc.lamports, LAMPORTS_PER_SOL);
    });

    it('Transfer SOL with Program', () => {
        const payerAccount = Keypair.generate();
        const ixPayer = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: payerAccount.publicKey,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programId,
        });
        const txPayer = new Transaction().add(ixPayer);
        txPayer.feePayer = payer.publicKey;
        txPayer.recentBlockhash = svm.latestBlockhash();
        txPayer.sign(payer, payerAccount);
        svm.sendTransaction(txPayer);
        svm.expireBlockhash();

        const recipientAccount = Keypair.generate();

        const ixArgs = {
            amount: new anchor.BN(LAMPORTS_PER_SOL),
        };
        const data = coder.instruction.encode('transfer_sol_with_program', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payerAccount.publicKey, isSigner: true, isWritable: true },
                {
                    pubkey: recipientAccount.publicKey,
                    isSigner: false,
                    isWritable: true,
                },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, payerAccount);
        svm.sendTransaction(tx);

        const recipientAcc = svm.getAccount(recipientAccount.publicKey);
        assert.equal(recipientAcc.lamports, LAMPORTS_PER_SOL);
    });
});
