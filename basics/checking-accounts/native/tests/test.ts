import { describe, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { start } from 'solana-bankrun';

describe('Checking accounts', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'checking_accounts_native_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;
    const rent = await client.getRent();

    // We'll create this ahead of time.
    // Our program will try to modify it.
    const accountToChange = Keypair.generate();
    // Our program will create this.
    const accountToCreate = Keypair.generate();

    test('Create an account owned by our program', async () => {
        const blockhash = context.lastBlockhash;
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: accountToChange.publicKey,
            lamports: Number(rent.minimumBalance(BigInt(0))),
            space: 0,
            programId: PROGRAM_ID, // Our program
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, accountToChange);

        await client.processTransaction(tx);
    });

    test('Check accounts', async () => {
        const blockhash = context.lastBlockhash;
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
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, accountToChange, accountToCreate);

        await client.processTransaction(tx);
    });
});
