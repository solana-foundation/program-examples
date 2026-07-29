import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const CreateTokenArgsSchema = { struct: { token_decimals: 'u8' } };

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

describe('Create Token', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/token_2022_mint_close_authority_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    test('Create a Token-22 SPL-Token !', () => {
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
        const blockhash = svm.latestBlockhash();

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, mintKeypair);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert(result.logs()[0].startsWith(`Program ${PROGRAM_ID}`));
        console.log('Token Mint Address: ', mintKeypair.publicKey.toBase58());
    });
});
