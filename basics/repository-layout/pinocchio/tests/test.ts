import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { start } from 'solana-bankrun';

describe('Carnival (Pinocchio)', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'repository_layout_pinocchio_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    const CarnivalInstructionSchema = {
        struct: {
            name: 'string',
            height: 'u32',
            ticket_count: 'u32',
            attraction: 'string',
            attraction_name: 'string',
        },
    };

    type CarnivalInstruction = {
        name: string;
        height: number;
        ticket_count: number;
        attraction: string;
        attraction_name: string;
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    async function sendCarnivalInstructions(instructionsList: CarnivalInstruction[]) {
        const tx = new Transaction();
        for (const ix of instructionsList) {
            tx.recentBlockhash = context.lastBlockhash;
            tx.add(
                new TransactionInstruction({
                    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
                    programId: PROGRAM_ID,
                    data: borshSerialize(CarnivalInstructionSchema, ix),
                }),
            ).sign(payer);
        }
        await client.processTransaction(tx);
    }

    test('Go on some rides!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'ride',
                attraction_name: 'Scrambler',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'ride',
                attraction_name: 'Ferris Wheel',
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'ride',
                attraction_name: 'Scrambler',
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'ride',
                attraction_name: 'Tilt-a-Whirl',
            },
        ]);
    });

    test('Play some games!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'game',
                attraction_name: 'I Got It!',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'game',
                attraction_name: 'Ring Toss',
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'game',
                attraction_name: 'Ladder Climb',
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'game',
                attraction_name: 'Ring Toss',
            },
        ]);
    });

    test('Eat some food!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'food',
                attraction_name: 'Taco Shack',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'food',
                attraction_name: "Larry's Pizza",
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'food',
                attraction_name: "Dough Boy's",
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'food',
                attraction_name: "Dough Boy's",
            },
        ]);
    });
});
