import * as anchor from '@anchor-lang/core';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import { LiteSVMProvider } from 'anchor-litesvm';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/transfer_tokens.json';
import type { TransferTokens } from '../target/types/transfer_tokens';

const PROGRAM_ID = new PublicKey(IDL.address);
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

describe('Transfer Tokens LiteSVM', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/transfer_tokens.so');
    client.addProgramFromFile(METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<TransferTokens>(IDL, provider);

    const metadata = {
        name: 'Solana Gold',
        symbol: 'GOLDSOL',
        uri: 'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
    };

    // Generate new keypair to use as address for mint account.
    const mintKeypair = new Keypair();

    // Generate new keypair to use as address for recipient wallet.
    const recipient = new Keypair();

    // Derive the associated token address account for the mint and payer.
    const senderTokenAddress = getAssociatedTokenAddressSync(mintKeypair.publicKey, payer.publicKey);

    // Derive the associated token address account for the mint and recipient.
    const recepientTokenAddress = getAssociatedTokenAddressSync(mintKeypair.publicKey, recipient.publicKey);

    it('Create an SPL Token!', async () => {
        const transactionSignature = await program.methods
            .createToken(metadata.name, metadata.symbol, metadata.uri)
            .accountsPartial({
                payer: payer.publicKey,
                mintAccount: mintKeypair.publicKey,
            })
            .signers([mintKeypair])
            .rpc();

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });

    it('Mint tokens!', async () => {
        // Amount of tokens to mint.
        const amount = new anchor.BN(100);

        // Mint the tokens to the associated token account.
        const transactionSignature = await program.methods
            .mintToken(amount)
            .accountsPartial({
                mintAuthority: payer.publicKey,
                recipient: payer.publicKey,
                mintAccount: mintKeypair.publicKey,
                associatedTokenAccount: senderTokenAddress,
            })
            .rpc();

        console.log('Success!');
        console.log(`   Associated Token Account Address: ${senderTokenAddress}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });

    it('Transfer tokens!', async () => {
        // Amount of tokens to transfer.
        const amount = new anchor.BN(50);

        const transactionSignature = await program.methods
            .transferTokens(amount)
            .accountsPartial({
                sender: payer.publicKey,
                recipient: recipient.publicKey,
                mintAccount: mintKeypair.publicKey,
                senderTokenAccount: senderTokenAddress,
                recipientTokenAccount: recepientTokenAddress,
            })
            .rpc();

        console.log('Success!');
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });
});
