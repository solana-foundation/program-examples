import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    getOrCreateAssociatedTokenAccount,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair } from '@solana/web3.js';
import type { ExtensionNft } from '../target/types/extension_nft';

describe('extension_nft', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.ExtensionNft as Program<ExtensionNft>;
    const payer = provider.wallet as anchor.Wallet;

    it('Mint nft!', async () => {
        const balance = await anchor.getProvider().connection.getBalance(payer.publicKey);

        if (balance < 1e8) {
            const res = await anchor.getProvider().connection.requestAirdrop(payer.publicKey, 1e9);
            await anchor.getProvider().connection.confirmTransaction(res, 'confirmed');
        }

        const mint = new Keypair();
        console.log('Mint public key', mint.publicKey.toBase58());

        const destinationTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            payer.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        getOrCreateAssociatedTokenAccount;
        const tx = await program.methods
            .mintNft()
            .accounts({
                signer: payer.publicKey,
                tokenAccount: destinationTokenAccount,
                mint: mint.publicKey,
            })
            .signers([mint])
            .rpc();

        console.log('Mint nft tx', tx);
        await anchor.getProvider().connection.confirmTransaction(tx, 'confirmed');
    });
});
