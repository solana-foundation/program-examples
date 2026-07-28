import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { burnChecked, createAccount, getAccount, mintTo, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { PermanentDelegate } from '../target/types/permanent_delegate';

describe('permanent-delegate', () => {
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.PermanentDelegate as Program<PermanentDelegate>;

    const mintKeypair = new anchor.web3.Keypair();

    it('Create Mint with Permanent Delegate', async () => {
        const transactionSignature = await program.methods
            .initialize()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Create Token Account, Mint Tokens, and burn with Permanent Delegate', async () => {
        const amount = 100;

        // Random keypair to use as owner of Token Account
        const randomKeypair = new anchor.web3.Keypair();

        // Create Token Account owned by random keypair
        const sourceTokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            randomKeypair.publicKey, // Token Account owner
            undefined, // Optional keypair, default to Associated Token Account
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        // Mint tokens to sourceTokenAccount
        await mintTo(
            connection,
            wallet.payer, // Transaction fee payer
            mintKeypair.publicKey, // Mint Account address
            sourceTokenAccount, // Mint to
            wallet.publicKey, // Mint Authority address
            amount, // Amount
            undefined, // Additional signers
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        // Burn tokens from sourceTokenAccount, using Permanent Delegate
        // The permanent delegate can burn / transfer tokens from all token account for the mint account
        const transactionSignature = await burnChecked(
            connection,
            wallet.payer, // Transaction fee payer
            sourceTokenAccount, // Tranfer from
            mintKeypair.publicKey, // Mint Account address
            wallet.publicKey, // Use Permanent Delegate as owner
            amount, // Amount
            2, // Mint Account decimals
            undefined, // Additional signers
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );
        console.log('Your transaction signature', transactionSignature);

        const tokenAccount = await getAccount(connection, sourceTokenAccount, null, TOKEN_2022_PROGRAM_ID);
        console.log('Token Account Balance:', Number(tokenAccount.amount));
    });
});
