import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import {
    createEnableCpiGuardInstruction,
    createInitializeAccountInstruction,
    createMint,
    disableCpiGuard,
    ExtensionType,
    getAccountLen,
    mintTo,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { SystemProgram, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import type { CpiGuard } from '../target/types/cpi_guard';

describe('cpi-guard', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.CpiGuard as Program<CpiGuard>;

    const mintKeypair = new anchor.web3.Keypair();
    const tokenKeypair = new anchor.web3.Keypair();

    it('Create Token Account with CpiGuard extension', async () => {
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

        // Size of Token Account with extension
        const accountLen = getAccountLen([ExtensionType.CpiGuard]);
        // Minimum lamports required for Token Account
        const lamports = await connection.getMinimumBalanceForRentExemption(accountLen);

        // Instruction to invoke System Program to create new account
        const createAccountInstruction = SystemProgram.createAccount({
            fromPubkey: wallet.publicKey, // Account that will transfer lamports to created account
            newAccountPubkey: tokenKeypair.publicKey, // Address of the account to create
            space: accountLen, // Amount of bytes to allocate to the created account
            lamports, // Amount of lamports transferred to created account
            programId: TOKEN_2022_PROGRAM_ID, // Program assigned as owner of created account
        });

        // Instruction to initialize Token Account data
        const initializeAccountInstruction = createInitializeAccountInstruction(
            tokenKeypair.publicKey, // Token Account Address
            mintKeypair.publicKey, // Mint Account
            wallet.publicKey, // Token Account Owner
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        // Instruction to initialize the CpiGuard Extension
        const enableCpiGuiardInstruction = createEnableCpiGuardInstruction(
            tokenKeypair.publicKey,
            wallet.publicKey,
            [],
            TOKEN_2022_PROGRAM_ID,
        );

        const transaction = new Transaction().add(
            createAccountInstruction,
            initializeAccountInstruction,
            enableCpiGuiardInstruction,
        );

        const transactionSignature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [wallet.payer, tokenKeypair], // Signers
        );

        await mintTo(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            tokenKeypair.publicKey,
            wallet.payer,
            1,
            [],
            null,
            TOKEN_2022_PROGRAM_ID,
        );

        console.log('Your transaction signature', transactionSignature);
    });

    it('Transfer, expect fail', async () => {
        try {
            await program.methods
                .cpiTransfer()
                .accounts({
                    sender: wallet.publicKey,
                    senderTokenAccount: tokenKeypair.publicKey,
                    mintAccount: mintKeypair.publicKey,
                })
                .rpc({ skipPreflight: true });
        } catch (error) {
            console.log('\nExpect Error:', error.message);
        }
    });

    it('Disable CpiGuard', async () => {
        const transactionSignature = await disableCpiGuard(
            connection,
            wallet.payer,
            tokenKeypair.publicKey,
            wallet.publicKey,
        );
        console.log('Your transaction signature', transactionSignature);
    });

    it('Transfer, expect success', async () => {
        const transactionSignature = await program.methods
            .cpiTransfer()
            .accounts({
                sender: wallet.publicKey,
                senderTokenAccount: tokenKeypair.publicKey,
                mintAccount: mintKeypair.publicKey,
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });
});
