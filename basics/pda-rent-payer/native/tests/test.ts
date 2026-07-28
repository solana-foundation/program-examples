import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { start } from 'solana-bankrun';

describe('PDA Rent-Payer', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'pda_rent_payer_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

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

    test('Initialize the Rent Vault', async () => {
        const blockhash = context.lastBlockhash;
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
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        await client.processTransaction(tx);
    });

    test('Create a new account using the Rent Vault', async () => {
        const blockhash = context.lastBlockhash;
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
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, newAccount); // Add instruction and Sign the transaction

        // Now we process the transaction
        await client.processTransaction(tx);
    });
});
