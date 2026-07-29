import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Carnival', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/repository_layout_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

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

    function sendCarnivalInstructions(instructionsList: CarnivalInstruction[]) {
        const tx = new Transaction();
        for (const ix of instructionsList) {
            tx.recentBlockhash = svm.latestBlockhash();
            tx.add(
                new TransactionInstruction({
                    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
                    programId: PROGRAM_ID,
                    data: borshSerialize(CarnivalInstructionSchema, ix),
                }),
            ).sign(payer);
        }
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    test('Go on some rides!', () => {
        sendCarnivalInstructions([
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

    test('Play some games!', () => {
        sendCarnivalInstructions([
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

    test('Eat some food!', () => {
        sendCarnivalInstructions([
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
