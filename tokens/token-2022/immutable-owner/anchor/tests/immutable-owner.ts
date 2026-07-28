import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { AuthorityType, createMint, setAuthority, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { ImmutableOwner } from '../target/types/immutable_owner';

describe('immutable-owner', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.ImmutableOwner as Program<ImmutableOwner>;

    const tokenKeypair = new anchor.web3.Keypair();

    it('Create Token Account with ImmutableOwner extension', async () => {
        const mint = await createMint(
            connection,
            wallet.payer, // Payer of the transaction and initialization fees
            wallet.publicKey, // Mint Authority
            null, // Optional Freeze Authority
            2, // Decimals of Mint
            undefined, // Optional keypair
            undefined, // Options for confirming the transaction
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        const transactionSignature = await program.methods
            .initialize()
            .accounts({
                mintAccount: mint,
                tokenAccount: tokenKeypair.publicKey,
            })
            .signers([tokenKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Attempt to change token account owner, expect fail', async () => {
        try {
            await setAuthority(
                connection, // Connection to use
                wallet.payer, // Payer of the transaction fee
                tokenKeypair.publicKey, // Token Account
                wallet.publicKey, // Owner of the Token Account
                AuthorityType.AccountOwner, // Type of Authority
                new anchor.web3.Keypair().publicKey, // Random address as new account Owner
                undefined, // Additional signers
                undefined, // Confirmation options
                TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
            );
        } catch (error) {
            console.log('\nExpect Error:', error.logs);
        }
    });
});
