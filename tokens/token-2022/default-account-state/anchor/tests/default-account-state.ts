import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { createAccount, mintTo, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { DefaultAccountState } from '../target/types/default_account_state';

describe('default-account-state', () => {
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.DefaultAccountState as Program<DefaultAccountState>;

    const mintKeypair = new anchor.web3.Keypair();

    it('Create Mint with DefaultAccountState extension', async () => {
        const transactionSignature = await program.methods
            .initialize()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Attempt Mint Token, expect fail', async () => {
        const amount = 1;

        // Create a token account, default state is frozen
        const tokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            wallet.payer.publicKey, // Token Account owner
            new anchor.web3.Keypair(), // Optional keypair
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        try {
            // Attempt to mint tokens, expect error
            await mintTo(
                connection,
                wallet.payer, // Transaction fee payer
                mintKeypair.publicKey, // Mint
                tokenAccount, // Mint to
                wallet.payer, // Mint authority
                amount, // Amount
                [], // Additional signers
                null, // Commitment
                TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
            );
        } catch (error) {
            console.log('\nExpect Error:', error.logs);
        }
    });

    it('Update DefaultAccountState', async () => {
        // Update the default state to initialized (not frozen)
        const transactionSignature = await program.methods
            .updateDefaultState({ initialized: {} })
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Attempt Mint Token, expect success', async () => {
        const amount = 1;

        // Create a token account, default state is initialized (not frozen)
        const tokenAccount = await createAccount(
            connection,
            wallet.payer, // Payer to create Token Account
            mintKeypair.publicKey, // Mint Account address
            wallet.payer.publicKey, // Token Account owner
            new anchor.web3.Keypair(), // Optional keypair
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        await mintTo(
            connection,
            wallet.payer, // Transaction fee payer
            mintKeypair.publicKey, // Mint
            tokenAccount, // Mint to
            wallet.payer, // Mint authority
            amount, // Amount
            [], // Additional signers
            null, // Commitment
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );
    });
});
