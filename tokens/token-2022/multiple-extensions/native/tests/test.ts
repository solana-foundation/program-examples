import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
    Keypair,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { start } from 'solana-bankrun';

const CreateTokenArgsSchema = { struct: { token_decimals: 'u8' } };

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

describe('Create Token', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'token_2022_multiple_extensions_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    test('Create a Token-22 SPL-Token !', async () => {
        const blockhash = context.lastBlockhash;
        const mintKeypair: Keypair = Keypair.generate();

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            token_decimals: 9,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // Mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint close authority account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Transaction Payer
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // Rent account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, mintKeypair);

        const transaction = await client.processTransaction(tx);

        assert(transaction.logMessages[0].startsWith(`Program ${PROGRAM_ID}`));
        console.log('Token Mint Address: ', mintKeypair.publicKey.toBase58());
    });
});
