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
import Idl from '../target/idl/rent_example.json' with { type: 'json' };

describe('LiteSVM: Create a system account', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(Idl.address);
    const coder = new anchor.BorshCoder(Idl as anchor.Idl);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(2 * LAMPORTS_PER_SOL));

    const programPath = new URL('../target/deploy/rent_example.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    it('Create the account', () => {
        const newKeypair = Keypair.generate();

        const ixArgs = {
            address_data: {
                name: 'Marcus',
                address: '123 Main St. San Francisco, CA',
            },
        };

        /**
         * Create Instructions
         * Create Transactions
         * Send Transactions
         */
        const data = coder.instruction.encode('create_system_account', ixArgs);
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
         * We're just going to serialize our object here so we can check
         * the size on the client side against the program logs
         */
        const addressDataBuffer = coder.types.encode('AddressData', ixArgs.address_data);

        //Fetch newKeypair account and check its rent for space
        const newKeypairInfo = svm.getAccount(newKeypair.publicKey);

        assert.equal(newKeypairInfo.data.length, addressDataBuffer.length);
    });
});
