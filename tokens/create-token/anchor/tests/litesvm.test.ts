import * as anchor from '@anchor-lang/core';
import { Keypair, PublicKey } from '@solana/web3.js';
import { LiteSVMProvider } from 'anchor-litesvm';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/create_token.json' with { type: 'json' };
import type { CreateToken } from '../target/types/create_token.ts';

const PROGRAM_ID = new PublicKey(IDL.address);
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

describe('LiteSVM example', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/create_token.so');
    client.addProgramFromFile(METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');
    const provider = new LiteSVMProvider(client);
    const payer = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<CreateToken>(IDL, provider);

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
