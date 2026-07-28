import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { closeAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { MintCloseAuthority } from '../target/types/mint_close_authority';

describe('mint-close-authority', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.MintCloseAuthority as Program<MintCloseAuthority>;

    const mintKeypair = new anchor.web3.Keypair();

    it('Create Mint with Close Authority', async () => {
        const transactionSignature = await program.methods
            .initialize()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Close Mint with Anchor CPI', async () => {
        const transactionSignature = await program.methods
            .close()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Create Mint with Close Authority again', async () => {
        const transactionSignature = await program.methods
            .initialize()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Close Mint using @solana/spl-token', async () => {
        const transactionSignature = await closeAccount(
            connection,
            wallet.payer, // Transaction fee payer
            mintKeypair.publicKey, // Mint Account address
            wallet.publicKey, // Account to receive lamports from closed account
            wallet.publicKey, // Close Authority for Mint Account
            undefined, // Additional signers
            undefined, // Confirmation options
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );
        console.log('Your transaction signature', transactionSignature);
    });
});
