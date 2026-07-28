import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/processing_instructions.json' with { type: 'json' };

describe('LiteSVM: custom-instruction-data', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    /**
     * Creates a coder to easily build and encode program instructions based on the IDL.
     */
    const coder = new anchor.BorshCoder(IDL as anchor.Idl);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    /**
     * Load the processing_instructions program binary into the LiteSVM instance
     * for local testing and simulation.
     */
    const programPath = new URL('../target/deploy/processing_instructions.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    it('Go to the park!', () => {
        /**
         * Create an instruction for the 'go_to_park' method using the Anchor coder.
         * Arguments are needed for this instruction so we give inside `{}`.
         */
        const ixArgs = {
            name: 'Jimmy',
            height: 5,
        };
        const data = coder.instruction.encode('go_to_park', ixArgs);

        /**
         * Build and sign a transaction to call the 'go_to_park' instruction
         * on the processing_instructions program with LiteSVM.
         */
        const ix = new TransactionInstruction({
            keys: [],
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
         * For Mary , height: 10
         */
        const ixArgs2 = {
            name: 'Mary',
            height: 10,
        };
        const data2 = coder.instruction.encode('go_to_park', ixArgs2);

        const ix2 = new TransactionInstruction({
            keys: [],
            programId,
            data: data2,
        });

        const tx2 = new Transaction().add(ix2);
        tx2.feePayer = payer.publicKey;
        tx2.recentBlockhash = svm.latestBlockhash();
        tx2.sign(payer);
        svm.sendTransaction(tx2);
    });
});
