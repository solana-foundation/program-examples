import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import type { CreateToken } from '../target/types/create_token.ts';

describe('Create Tokens', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.CreateToken as anchor.Program<CreateToken>;

    const metadata = {
        name: 'Solana Gold',
        symbol: 'GOLDSOL',
        uri: 'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
    };

    it('Create an SPL Token!', async () => {
        // Generate new keypair to use as address for mint account.
        const mintKeypair = new Keypair();

        // SPL Token default = 9 decimals
        const transactionSignature = await program.methods
            .createTokenMint(9, metadata.name, metadata.symbol, metadata.uri)
            .accounts({
                payer: payer.publicKey,
                mintAccount: mintKeypair.publicKey,
            })
            .signers([mintKeypair])
            .rpc();

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });

    it('Create an NFT!', async () => {
        // Generate new keypair to use as address for mint account.
        const mintKeypair = new Keypair();

        // NFT default = 0 decimals
        const transactionSignature = await program.methods
            .createTokenMint(0, metadata.name, metadata.symbol, metadata.uri)
            .accounts({
                payer: payer.publicKey,
                mintAccount: mintKeypair.publicKey,
            })
            .signers([mintKeypair])
            .rpc();

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });
});
