import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createCloseUserInstruction, createCreateUserInstruction } from '../ts';

describe('Close Account!', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/close_account_native_program.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const testAccountPublicKey = PublicKey.findProgramAddressSync(
        [Buffer.from('USER'), payer.publicKey.toBuffer()],
        PROGRAM_ID,
    )[0];

    it('Create the account', () => {
        const ix = createCreateUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID, 'Jacob');

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    it('Close the account', () => {
        const ix = createCloseUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID);
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
