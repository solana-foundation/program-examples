import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/create_system_account.json' with { type: 'json' };

describe('LiteSVM: Create a system account', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    const coder = new anchor.BorshCoder(IDL as anchor.Idl);
    const programPath = new URL('../target/deploy/create_system_account.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    it('Create the account', () => {
        /**
         * Generate a new keypair for the new account
         */
        const newKeypair = new Keypair();
        /**
         * Instruction data
         * Create Transaction
         * Send Transaction
         */
        const data = coder.instruction.encode('create_system_account', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: newKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, newKeypair);
        svm.sendTransaction(tx);

        /**
         * Fetch account
         * Check its lamports
         * */
        const lamports = svm.minimumBalanceForRentExemption(0n);
        const accountInfo = svm.getAccount(newKeypair.publicKey);

        assert(Number(lamports) === accountInfo.lamports);
    });
});
