import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/hello_solana.json' with { type: 'json' };

describe('LiteSVM: hello-solana', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    /**
     * Creates a coder to easily build and encode program instructions based on the IDL.
     */
    const coder = new anchor.BorshCoder(IDL as anchor.Idl);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    /**
     * Load the hello_solana program binary into the LiteSVM instance
     * for local testing and simulation.
     */
    const programPath = new URL('../target/deploy/hello_solana.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    it('Say hello!', () => {
        /**
         * Create an instruction for the 'hello' method using the Anchor coder.
         * No arguments are needed for this instruction so i give `{}`.
         */
        const data = coder.instruction.encode('hello', {});

        /**
         * Build and sign a transaction to call the 'hello' instruction
         * on the hello_solana program with LiteSVM.
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
    });
});
