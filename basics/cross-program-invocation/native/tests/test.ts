import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { LiteSVM, TransactionMetadata } from 'litesvm';

const PowerStatusSchema = { struct: { is_on: 'u8' } };
const SetPowerStatusSchema = { struct: { name: 'string' } };

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

describe('Native CPI Example', () => {
    let svm: LiteSVM;
    let payer: Keypair;
    let handProgramId: Keypair;
    let leverProgramId: Keypair;
    let powerAccount: Keypair;

    before(() => {
        svm = new LiteSVM();
        payer = Keypair.generate();

        handProgramId = Keypair.fromSecretKey(
            Uint8Array.from(
                JSON.parse(
                    fs.readFileSync('./tests/fixtures/cross_program_invocatio_native_hand-keypair.json', 'utf-8'),
                ),
            ),
        );
        leverProgramId = Keypair.fromSecretKey(
            Uint8Array.from(
                JSON.parse(
                    fs.readFileSync('./tests/fixtures/cross_program_invocatio_native_lever-keypair.json', 'utf-8'),
                ),
            ),
        );

        svm.airdrop(payer.publicKey, BigInt(10 * 1_000_000_000));

        const native_hand = path.join('./tests/fixtures', 'cross_program_invocatio_native_hand.so');
        const native_lever = path.join('./tests/fixtures', 'cross_program_invocatio_native_lever.so');

        svm.addProgramFromFile(handProgramId.publicKey, native_hand);
        svm.addProgramFromFile(leverProgramId.publicKey, native_lever);

        powerAccount = Keypair.generate();
    });

    it('Initialize the lever!', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: leverProgramId.publicKey,
            data: borshSerialize(PowerStatusSchema, { is_on: 1 }),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.feePayer = payer.publicKey;
        tx.add(ix);
        tx.sign(payer, powerAccount);

        const res = svm.sendTransaction(tx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });

    it('Pull the lever!', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: leverProgramId.publicKey, isSigner: false, isWritable: false },
            ],
            programId: handProgramId.publicKey,
            data: borshSerialize(SetPowerStatusSchema, { name: 'Chris' }),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.feePayer = payer.publicKey;
        tx.add(ix);
        tx.sign(payer);

        const res = svm.sendTransaction(tx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });

    it('Pull it again!', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: leverProgramId.publicKey, isSigner: false, isWritable: false },
            ],
            programId: handProgramId.publicKey,
            data: borshSerialize(SetPowerStatusSchema, { name: 'Ashley' }),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.feePayer = payer.publicKey;
        tx.add(ix);
        tx.sign(payer);

        const res = svm.sendTransaction(tx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });
});
