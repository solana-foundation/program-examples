import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('PDA Rent-Payer', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/pda_rent_payer_program.so');
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(2 * LAMPORTS_PER_SOL));

    const MyInstruction = {
        InitRentVault: 0,
        CreateNewAccount: 1,
    } as const;

    const InitRentVaultSchema = {
        struct: {
            instruction: 'u8',
            fund_lamports: 'u64',
        },
    };

    const CreateNewAccountSchema = {
        struct: {
            instruction: 'u8',
        },
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    function deriveRentVaultPda() {
        const pda = PublicKey.findProgramAddressSync([Buffer.from('rent_vault')], PROGRAM_ID);
        console.log(`PDA: ${pda[0].toBase58()}`);
        return pda;
    }

    test('Initialize the Rent Vault', () => {
        const [rentVaultPda, _] = deriveRentVaultPda();
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: rentVaultPda, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(InitRentVaultSchema, {
                instruction: MyInstruction.InitRentVault,
                fund_lamports: 1000000000,
            }),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    test('Create a new account using the Rent Vault', () => {
        const newAccount = Keypair.generate();
        const [rentVaultPda, _] = deriveRentVaultPda();
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: newAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: rentVaultPda, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(CreateNewAccountSchema, {
                instruction: MyInstruction.CreateNewAccount,
            }),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, newAccount); // Add instruction and Sign the transaction

        // Now we process the transaction
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
