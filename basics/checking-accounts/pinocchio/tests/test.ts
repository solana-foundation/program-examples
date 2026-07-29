import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Checking accounts', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/checking_accounts_pinocchio_program.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
    const rentExemptBalance = svm.minimumBalanceForRentExemption(BigInt(0));

    // We'll create this ahead of time.
    // Our program will try to modify it.
    const accountToChange = Keypair.generate();
    // Our program will create this.
    const accountToCreate = Keypair.generate();

    test('Create an account owned by our program', () => {
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: accountToChange.publicKey,
            lamports: Number(rentExemptBalance),
            space: 0,
            programId: PROGRAM_ID, // Our program
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, accountToChange);

        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    test('Check accounts', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: accountToCreate.publicKey, isSigner: true, isWritable: true },
                { pubkey: accountToChange.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, accountToChange, accountToCreate);

        const result = svm.sendTransaction(tx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
