import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { amountToUiAmount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { InterestBearing } from '../target/types/interest_bearing';

describe('interest-bearing', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.InterestBearing as Program<InterestBearing>;

    const mintKeypair = new anchor.web3.Keypair();

    it('Create Mint with InterestBearingConfig extension', async () => {
        const rate = 0;

        const transactionSignature = await program.methods
            .initialize(rate)
            .accounts({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Update Mint with Interest Rate', async () => {
        const rate = 100;

        const transactionSignature = await program.methods
            .updateRate(rate)
            .accounts({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    it('Calculate accrued interest', async () => {
        await sleep(1);

        const amount = 1000;
        // Convert amount to UI amount with accrued interest
        // This helper is a simulated transaction
        const uiAmount = await amountToUiAmount(
            connection,
            wallet.payer,
            mintKeypair.publicKey, // Address of the Mint account
            amount, // Amount to be converted
            TOKEN_2022_PROGRAM_ID, // Token Extension Program ID
        );

        console.log('\nAmount with Accrued Interest:', uiAmount);
    });
});

function sleep(s: number) {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}
