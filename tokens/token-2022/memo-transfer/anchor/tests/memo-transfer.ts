import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { createMemoInstruction } from '@solana/spl-memo';
import { createAccount, createMint, createTransferInstruction, mintTo, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import type { MemoTransfer } from '../target/types/memo_transfer';

describe('memo-transfer', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.MemoTransfer as Program<MemoTransfer>;

    const mintKeypair = new anchor.web3.Keypair();
    const tokenKeypair = new anchor.web3.Keypair();

    it('Create Token Account with RequiredMemo extension', async () => {
        await createMint(
            connection,
            wallet.payer, // Payer of the transaction and initialization fees
            wallet.publicKey, // Mint Authority
            null, // Optional Freeze Authority
            2, // Decimals of Mint
            mintKeypair, // Optional keypair
            undefined, // Options for confirming the transaction
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        const transactionSignature = await program.methods
            .initialize()
            .accounts({
                mintAccount: mintKeypair.publicKey,
                tokenAccount: tokenKeypair.publicKey,
            })
            .signers([tokenKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Attempt transfer without memo, expect fail', async () => {
        // Create a new token account to transfer to
        const sourceTokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            wallet.publicKey, // Token Account owner
            new anchor.web3.Keypair(), // Optional keypair,
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        await mintTo(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            sourceTokenAccount,
            wallet.payer,
            1,
            [],
            null,
            TOKEN_2022_PROGRAM_ID,
        );

        const transferInstruction = createTransferInstruction(
            sourceTokenAccount, // Source Token Account
            tokenKeypair.publicKey, // Destination Token Account
            wallet.publicKey, // Source Token Account owner
            1, // Amount
            undefined, // Additional signers
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        const transaction = new Transaction().add(transferInstruction);

        try {
            // Send transaction
            await sendAndConfirmTransaction(
                connection,
                transaction,
                [wallet.payer], // Signers
            );
        } catch (error) {
            console.log('\nExpect Error:', error.logs);
        }
    });

    it('Attempt transfer with memo, expect success', async () => {
        // Create a new token account to transfer to
        const sourceTokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            wallet.publicKey, // Token Account owner
            new anchor.web3.Keypair(), // Optional keypair, default to Associated Token Account
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        await mintTo(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            sourceTokenAccount,
            wallet.payer,
            1,
            [],
            null,
            TOKEN_2022_PROGRAM_ID,
        );

        const memoInstruction = createMemoInstruction('hello, world', [wallet.publicKey]);

        const transferInstruction = createTransferInstruction(
            sourceTokenAccount, // Source Token Account
            tokenKeypair.publicKey, // Destination Token Account
            wallet.publicKey, // Source Token Account owner
            1, // Amount
            undefined, // Additional signers
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        const transaction = new Transaction().add(memoInstruction, transferInstruction);

        const transactionSignature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet.payer], // Signers
        );

        console.log('Your transaction signature', transactionSignature);
    });

    it('Disable RequiredMemo extension', async () => {
        const transactionSignature = await program.methods
            .disable()
            .accounts({
                tokenAccount: tokenKeypair.publicKey,
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Attempt transfer without memo, expect success', async () => {
        // Create a new token account to transfer to
        const sourceTokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            wallet.publicKey, // Token Account owner
            new anchor.web3.Keypair(), // Optional keypair,
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        await mintTo(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            sourceTokenAccount,
            wallet.payer,
            1,
            [],
            null,
            TOKEN_2022_PROGRAM_ID,
        );

        const transferInstruction = createTransferInstruction(
            sourceTokenAccount, // Source Token Account
            tokenKeypair.publicKey, // Destination Token Account
            wallet.publicKey, // Source Token Account owner
            1, // Amount
            undefined, // Additional signers
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        const transaction = new Transaction().add(transferInstruction);

        const transactionSignature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet.payer], // Signers
        );

        console.log('Your transaction signature', transactionSignature);
    });
});
