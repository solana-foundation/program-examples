import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import HAND_IDL from '../target/idl/hand.json' with { type: 'json' };
import LEVER_IDL from '../target/idl/lever.json' with { type: 'json' };

describe('LiteSVM: CPI', () => {
    const svm = new LiteSVM();
    const handProgramId = new PublicKey(HAND_IDL.address);
    const leverProgramId = new PublicKey(LEVER_IDL.address);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    /**
     * For serialization and deserialization of data
     */
    const handCoder = new anchor.BorshCoder(HAND_IDL as anchor.Idl);
    const leverCoder = new anchor.BorshCoder(LEVER_IDL as anchor.Idl);

    const handProgramPath = new URL('../target/deploy/hand.so', import.meta.url).pathname;
    const leverProgramPath = new URL('../target/deploy/lever.so', import.meta.url).pathname;
    svm.addProgramFromFile(handProgramId, handProgramPath);
    svm.addProgramFromFile(leverProgramId, leverProgramPath);

    /**
     * Generate a new keypair for the power account
     */
    const powerAccount = new Keypair();

    it('Initialize the lever!', () => {
        /**
         * Instruction data
         * Create Transaction
         * Send Transaction
         */
        const data = leverCoder.instruction.encode('initialize', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: leverProgramId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, powerAccount);
        svm.sendTransaction(tx);

        /**
         * Fetch account
         * Check its required lamports
         * Check it powerstatus
         * */
        const minLamports = svm.minimumBalanceForRentExemption(BigInt(8 + 8));
        const powerAccountInfo = svm.getAccount(powerAccount.publicKey);
        const powerStatus = leverCoder.accounts.decode('PowerStatus', Buffer.from(powerAccountInfo.data));

        assert(Number(minLamports) === powerAccountInfo.lamports);
        assert(powerStatus.is_on === false);
    });

    it('Pull the lever!', () => {
        /**
         * Instruction data
         * Create Transaction
         * Send Transaction
         */
        const data = handCoder.instruction.encode('pull_lever', {
            name: 'Jacob',
        });
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: leverProgramId, isSigner: false, isWritable: false },
            ],
            programId: handProgramId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        /**
         * Fetch account
         * Check its powerstatus = true
         * */
        const powerAccountInfo = svm.getAccount(powerAccount.publicKey);
        const powerStatus = leverCoder.accounts.decode('PowerStatus', Buffer.from(powerAccountInfo.data));

        assert(powerStatus.is_on === true);
    });

    it('Pull it again!', () => {
        /**
         * Instruction data
         * Create Transaction
         * Send Transaction
         */
        const data = handCoder.instruction.encode('pull_lever', {
            name: 'sol-warrior',
        });
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: leverProgramId, isSigner: false, isWritable: false },
            ],
            programId: handProgramId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        /**
         * Fetch account
         * Check its powerstatus = false
         * */
        const powerAccountInfo = svm.getAccount(powerAccount.publicKey);
        const powerStatus = leverCoder.accounts.decode('PowerStatus', Buffer.from(powerAccountInfo.data));

        assert(powerStatus.is_on === false);
    });
});
