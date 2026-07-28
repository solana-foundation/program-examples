import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { unpack } from '@solana/spl-token-metadata';
import type { Metadata } from '../target/types/metadata';

describe('metadata', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Metadata as Program<Metadata>;

    const mintKeypair = new anchor.web3.Keypair();

    const metadata = {
        name: 'OPOS',
        symbol: 'OPOS',
        uri: 'https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json',
    };

    it('Create Mint with MetadataPointer and TokenMetadata Extensions', async () => {
        const tx = await program.methods
            .initialize(metadata)
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', tx);
    });

    it('Update existing metadata field', async () => {
        // Add your test here.
        const tx = await program.methods
            .updateField({
                field: { name: {} }, // Update the name field
                value: 'Solana',
            })
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', tx);
    });

    it('Update metadata with custom field', async () => {
        const tx = await program.methods
            .updateField({
                field: { key: { 0: 'color' } }, // Add a custom field named "color"
                value: 'red',
            })
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', tx);
    });

    it('Remove custom field', async () => {
        const tx = await program.methods
            .removeKey('color') // Remove the custom field named "color"
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', tx);
    });

    it('Change update authority', async () => {
        const tx = await program.methods
            .updateAuthority()
            .accounts({
                mintAccount: mintKeypair.publicKey,
                newAuthority: null, // Set the update authority to null
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', tx);
    });

    it('Emit metadata, decode transaction logs', async () => {
        const txSignature = await program.methods
            .emit()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ commitment: 'confirmed', skipPreflight: true });
        console.log('Your transaction signature', txSignature);

        // Fetch the transaction response
        const transactionResponse = await provider.connection.getTransaction(txSignature, {
            commitment: 'confirmed',
        });

        // Extract the log message that starts with "Program return:"
        const prefix = 'Program return: ';
        let log = transactionResponse.meta.logMessages.find(log => log.startsWith(prefix));
        log = log.slice(prefix.length);
        const [_, data] = log.split(' ', 2);

        // Decode the data from base64 and unpack it into TokenMetadata
        const buffer = Buffer.from(data, 'base64');
        const metadata = unpack(buffer);
        console.log('Metadata', metadata);
    });

    it('Emit metadata, decode simulated transaction', async () => {
        const simulateResponse = await program.methods
            .emit()
            .accounts({ mintAccount: mintKeypair.publicKey })
            .simulate();

        // Extract the log message that starts with "Program return:"
        const prefix = 'Program return: ';
        let log = simulateResponse.raw.find(log => log.startsWith(prefix));
        log = log.slice(prefix.length);
        const [_, data] = log.split(' ', 2);

        // Decode the data from base64 and unpack it into TokenMetadata
        const buffer = Buffer.from(data, 'base64');
        const metadata = unpack(buffer);
        console.log('Metadata', metadata);
    });
});
