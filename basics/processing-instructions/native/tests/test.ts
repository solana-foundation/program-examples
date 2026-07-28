import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { start } from 'solana-bankrun';

describe('custom-instruction-data', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'processing_instructions_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    const InstructionDataSchema = {
        struct: {
            name: 'string',
            height: 'u32',
        },
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    test('Go to the park!', async () => {
        const blockhash = context.lastBlockhash;

        const jimmy = borshSerialize(InstructionDataSchema, {
            name: 'Jimmy',
            height: 3,
        });
        const mary = borshSerialize(InstructionDataSchema, {
            name: 'Mary',
            height: 10,
        });

        const ix1 = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: jimmy,
        });

        const ix2 = new TransactionInstruction({
            ...ix1,
            data: mary,
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix1).add(ix2).sign(payer);

        await client.processTransaction(tx);
    });
});
