import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('custom-instruction-data', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/processing_instructions_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    const InstructionDataSchema = {
        struct: {
            name: 'string',
            height: 'u32',
        },
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    test('Go to the park!', () => {
        const blockhash = svm.latestBlockhash();

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

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
