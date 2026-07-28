import { describe, test } from 'node:test';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { start } from 'solana-bankrun';

describe('Create a system account', async () => {
    const PROGRAM_ID = PublicKey.unique();

    const context = await start([{ name: 'create_account_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    test('Create the account via a cross program invocation', async () => {
        const newKeypair = Keypair.generate();

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: newKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.alloc(0),
        });

        const tx = new Transaction();
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix);
        tx.sign(payer, newKeypair);

        await client.processTransaction(tx);

        // Verify the account was created
        const _accountInfo = await client.getAccount(newKeypair.publicKey);
        console.log(`Account with public key ${newKeypair.publicKey} successfully created via CPI`);
    });

    test('Create the account via direct call to system program', async () => {
        const newKeypair = Keypair.generate();

        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: newKeypair.publicKey,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programId: SystemProgram.programId,
        });

        const tx = new Transaction();
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix);
        tx.sign(payer, newKeypair);

        await client.processTransaction(tx);

        // Verify the account was created
        const _accountInfo = await client.getAccount(newKeypair.publicKey);
        console.log(`Account with public key ${newKeypair.publicKey} successfully created`);
    });
});
