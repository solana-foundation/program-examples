import { Buffer } from 'node:buffer';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { start } from 'solana-bankrun';

// The legacy SPL Token and Associated Token Account programs are bundled with
// bankrun, so they are available without loading any extra fixtures.
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Instruction discriminators (must match the program's processor).
const CREATE_TOKEN = 0;
const MINT_TOKENS = 1;
const TRANSFER_TOKENS = 2;

// Encode a u64 as 8 little-endian bytes without relying on BigInt (tsconfig
// targets es6). Safe for amounts below 2^53.
function u64le(value: number): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(value >>> 0, 0);
    buffer.writeUInt32LE(Math.floor(value / 4294967296), 4); // 4294967296 = 2^32
    return buffer;
}

// Derive the associated token account address for a wallet + mint.
function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
}

// Read the `amount` field (u64 at offset 64) of an SPL token account.
function readTokenAmount(data: Uint8Array): number {
    const buffer = Buffer.from(data);
    return buffer.readUInt32LE(64) + buffer.readUInt32LE(68) * 4294967296; // 2^32
}

describe('Transfer Tokens (Pinocchio)', async () => {
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'transfer_tokens_pinocchio_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;
    const payer = context.payer;

    const mintKeypair = Keypair.generate();
    const recipient = Keypair.generate();

    const payerAta = getAssociatedTokenAddress(mintKeypair.publicKey, payer.publicKey);
    const recipientAta = getAssociatedTokenAddress(mintKeypair.publicKey, recipient.publicKey);

    async function sendInstruction(ix: TransactionInstruction, signers: Keypair[]) {
        const tx = new Transaction();
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix);
        tx.sign(...signers);
        await client.processTransaction(tx);
    }

    it('Creates an SPL token mint', async () => {
        const ix = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: false }, // mint authority
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
            ],
            data: Buffer.from([CREATE_TOKEN, 9]), // 9 decimals
        });

        await sendInstruction(ix, [payer, mintKeypair]);

        const mintAccount = await client.getAccount(mintKeypair.publicKey);
        if (mintAccount === null) throw new Error('Mint account not found');
        assert.deepEqual(mintAccount.owner.toBytes(), TOKEN_PROGRAM_ID.toBytes());
    });

    it('Mints tokens to the payer', async () => {
        const ix = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }, // mint account
                { pubkey: payerAta, isSigner: false, isWritable: true }, // destination ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // mint authority
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
                { pubkey: payer.publicKey, isSigner: false, isWritable: false }, // wallet (ATA owner)
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // ATA program
            ],
            data: Buffer.concat([Buffer.from([MINT_TOKENS]), u64le(150)]),
        });

        await sendInstruction(ix, [payer]);

        const ataAccount = await client.getAccount(payerAta);
        if (ataAccount === null) throw new Error('Associated token account not found');
        assert.equal(readTokenAmount(ataAccount.data), 150);
    });

    it('Transfers tokens to another wallet', async () => {
        const ix = new TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false }, // mint account
                { pubkey: payerAta, isSigner: false, isWritable: true }, // source ATA
                { pubkey: recipientAta, isSigner: false, isWritable: true }, // destination ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // authority
                { pubkey: recipient.publicKey, isSigner: false, isWritable: false }, // recipient wallet
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // ATA program
            ],
            data: Buffer.concat([Buffer.from([TRANSFER_TOKENS]), u64le(50)]),
        });

        await sendInstruction(ix, [payer]);

        const sourceAccount = await client.getAccount(payerAta);
        const destinationAccount = await client.getAccount(recipientAta);
        if (sourceAccount === null || destinationAccount === null) {
            throw new Error('Associated token account not found');
        }
        assert.equal(readTokenAmount(sourceAccount.data), 100);
        assert.equal(readTokenAmount(destinationAccount.data), 50);
    });
});
