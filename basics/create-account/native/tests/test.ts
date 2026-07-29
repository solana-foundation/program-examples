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

describe('Create a system account', () => {
    const PROGRAM_ID = PublicKey.unique();

    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/create_account_program.so');
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
            data: Buffer.alloc(512),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix);
        tx.sign(payer, newKeypair);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        // Verify the account was created with space derived from the instruction data
        const accountInfo = svm.getAccount(newKeypair.publicKey);
        if (accountInfo.data.length !== 512) throw new Error('unexpected account size');
        console.log(`Account with public key ${newKeypair.publicKey} successfully created via CPI`);
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
        tx.add(ix);
        tx.sign(payer, newKeypair);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        // Verify the account was created
        const accountInfo = svm.getAccount(newKeypair.publicKey);
        assert(accountInfo, 'Expected account to have been created');
        console.log(`Account with public key ${newKeypair.publicKey} successfully created`);
    });
});
