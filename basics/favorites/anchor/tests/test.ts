import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { assert } from 'chai';
import type { Favorites } from '../target/types/favorites.ts';

describe('Anchor: Favorites', () => {
    // Use the cluster and the keypair from Anchor.toml
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const web3 = anchor.web3;
    // See https://github.com/coral-xyz/anchor/issues/3122
    const user = (provider.wallet as anchor.Wallet).payer;
    const someRandomGuy = anchor.web3.Keypair.generate();
    const program = anchor.workspace.Favorites as Program<Favorites>;

    // Here's what we want to write to the blockchain
    const favoriteNumber = new anchor.BN(23);
    const favoriteColor = 'purple';
    const favoriteHobbies = ['skiing', 'skydiving', 'biking'];

    // We don't need to airdrop if we're using the local cluster
    // because the local cluster gives us 85 billion dollars worth of SOL
    before(async () => {
        const balance = await provider.connection.getBalance(user.publicKey);
        const balanceInSOL = balance / web3.LAMPORTS_PER_SOL;
        const formattedBalance = new Intl.NumberFormat().format(balanceInSOL);
        console.log(`Balance: ${formattedBalance} SOL`);
    });

    it('Writes our favorites to the blockchain', async () => {
        await program.methods
            // set_favourites in Rust becomes setFavorites in TypeScript
            .setFavorites(favoriteNumber, favoriteColor, favoriteHobbies)
            // Sign the transaction
            .signers([user])
            // Send the transaction to the cluster or RPC
            .rpc();

        // Find the PDA for the user's favorites
        const favoritesPdaAndBump = web3.PublicKey.findProgramAddressSync(
            [Buffer.from('favorites'), user.publicKey.toBuffer()],
            program.programId,
        );
        const favoritesPda = favoritesPdaAndBump[0];
        const dataFromPda = await program.account.favorites.fetch(favoritesPda);
        // And make sure it matches!
        assert.equal(dataFromPda.color, favoriteColor);
        // A little extra work to make sure the BNs are equal
        assert.equal(dataFromPda.number.toString(), favoriteNumber.toString());
        // And check the hobbies too
        assert.deepEqual(dataFromPda.hobbies, favoriteHobbies);
    });

    it('Updates the favorites', async () => {
        const newFavoriteHobbies = ['skiing', 'skydiving', 'biking', 'swimming'];

        await program.methods.setFavorites(favoriteNumber, favoriteColor, newFavoriteHobbies).signers([user]).rpc();

        // Find the PDA for the user's favorites
        const favoritesPdaAndBump = web3.PublicKey.findProgramAddressSync(
            [Buffer.from('favorites'), user.publicKey.toBuffer()],
            program.programId,
        );
        const favoritesPda = favoritesPdaAndBump[0];
        const dataFromPda = await program.account.favorites.fetch(favoritesPda);

        assert.equal(dataFromPda.color, favoriteColor);
        assert.equal(dataFromPda.number.toString(), favoriteNumber.toString());
        assert.deepEqual(dataFromPda.hobbies, newFavoriteHobbies);
    });

    it('Rejects transactions from unauthorized signers', async () => {
        try {
            await program.methods
                .setFavorites(favoriteNumber, favoriteColor, favoriteHobbies)
                .signers([someRandomGuy])
                .rpc();
            assert.fail('Expected unauthorized signer error');
        } catch (err) {
            assert.include((err as Error).message, 'unknown signer');
        }
    });
});
