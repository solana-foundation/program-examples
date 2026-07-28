import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';

import IDL from '../target/idl/favorites.json' with { type: 'json' };

describe('LiteSVM: Favorites', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const coder = new anchor.BorshCoder(IDL as anchor.Idl); //For serialization and deserialization
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    const programPath = new URL('../target/deploy/favorites.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    const [favPdaAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('favorites'), payer.publicKey.toBuffer()],
        programId,
    );
    /**
     * Here's what we want to write to the blockchain
     */
    const favoriteNumber = new anchor.BN(23);
    const favoriteColor = 'purple';
    const favoriteHobbies = ['skiing', 'skydiving', 'biking'];

    it('Writes our favorites to the blockchain', () => {
        const ixArgs = {
            number: favoriteNumber,
            color: favoriteColor,
            hobbies: favoriteHobbies,
        };

        const data = coder.instruction.encode('set_favorites', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: favPdaAccount, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        /**
         * Fetch the account and check its favorites
         */
        const favAccountInfo = svm.getAccount(favPdaAccount);
        const favAccount = coder.accounts.decode('Favorites', Buffer.from(favAccountInfo.data));

        assert.equal(favAccount.number.toNumber(), favoriteNumber.toNumber());
        assert.equal(favAccount.color, favoriteColor);
        assert.deepStrictEqual(favAccount.hobbies, favoriteHobbies);
    });

    it('Updates the favorites', () => {
        const newFavoriteHobbies = ['coding', 'reading', 'biking', 'swimming'];
        const ixArgs = {
            number: favoriteNumber,
            color: favoriteColor,
            hobbies: newFavoriteHobbies,
        };

        const data = coder.instruction.encode('set_favorites', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: favPdaAccount, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        /**
         * Fetch the account and check its favorites
         */
        const favAccountInfo = svm.getAccount(favPdaAccount);
        const favAccount = coder.accounts.decode('Favorites', Buffer.from(favAccountInfo.data));

        assert.equal(favAccount.number.toNumber(), favoriteNumber.toNumber());
        assert.equal(favAccount.color, favoriteColor);
        assert.deepStrictEqual(favAccount.hobbies, newFavoriteHobbies);
    });

    it('Rejects transactions from unauthorized signers', () => {
        const newFavoriteHobbies = ['coding', 'reading', 'biking'];
        const someRandomGuy = Keypair.generate();

        const ixArgs = {
            number: favoriteNumber,
            color: favoriteColor,
            hobbies: newFavoriteHobbies,
        };

        const data = coder.instruction.encode('set_favorites', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: favPdaAccount, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();

        assert.Throw(() => {
            tx.sign(someRandomGuy);
            svm.sendTransaction(tx);
        }, 'unknown signer');
    });
});
