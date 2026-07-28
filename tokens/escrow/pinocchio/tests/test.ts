import { AccountLayout } from '@solana/spl-token';
import { PublicKey, Transaction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { start } from 'solana-bankrun';
import { type OfferRaw, OfferSchema } from './account';
import { buildMakeOffer, buildTakeOffer } from './instruction';
import { createValues, mintingTokens } from './utils';

describe('Escrow (Pinocchio)', async () => {
    const values = createValues();

    const context = await start([{ name: 'escrow_pinocchio_program', programId: values.programId }], []);
    const client = context.banksClient;
    const payer = context.payer;

    // Fund the maker with token A and the taker with token B before trading.
    await mintingTokens({ context, holder: values.maker, mintKeypair: values.mintAKeypair });
    await mintingTokens({ context, holder: values.taker, mintKeypair: values.mintBKeypair });

    it('Makes an offer', async () => {
        const ix = buildMakeOffer({
            id: values.id,
            maker: values.maker.publicKey,
            maker_token_a: values.makerAccountA,
            offer: values.offer,
            bump: values.offerBump,
            token_a_offered_amount: values.amountA,
            token_b_wanted_amount: values.amountB,
            vault: values.vault,
            mint_a: values.mintAKeypair.publicKey,
            mint_b: values.mintBKeypair.publicKey,
            payer: payer.publicKey,
            programId: values.programId,
        });

        const tx = new Transaction();
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(payer, values.maker);
        await client.processTransaction(tx);

        const offerInfo = await client.getAccount(values.offer);
        if (offerInfo === null) throw new Error('Offer account not found');
        const offer = borsh.deserialize(OfferSchema, Buffer.from(offerInfo.data)) as OfferRaw;

        const vaultInfo = await client.getAccount(values.vault);
        if (vaultInfo === null) throw new Error('Vault account not found');
        const vaultTokenAccount = AccountLayout.decode(vaultInfo.data);

        assert(offer.id.toString() === values.id.toString(), 'wrong id');
        // borsh deserializes pubkeys as raw byte arrays, wrap in PublicKey for comparison
        assert(new PublicKey(offer.maker).toBase58() === values.maker.publicKey.toBase58(), 'maker key does not match');
        assert(
            new PublicKey(offer.token_mint_a).toBase58() === values.mintAKeypair.publicKey.toBase58(),
            'wrong mint A',
        );
        assert(
            new PublicKey(offer.token_mint_b).toBase58() === values.mintBKeypair.publicKey.toBase58(),
            'wrong mint B',
        );
        assert(offer.token_b_wanted_amount.toString() === values.amountB.toString(), 'unexpected amount B');
        assert(vaultTokenAccount.amount.toString() === values.amountA.toString(), 'unexpected amount A');
    });

    it('Takes the offer', async () => {
        const ix = buildTakeOffer({
            maker: values.maker.publicKey,
            offer: values.offer,
            vault: values.vault,
            mint_a: values.mintAKeypair.publicKey,
            mint_b: values.mintBKeypair.publicKey,
            maker_token_b: values.makerAccountB,
            taker: values.taker.publicKey,
            taker_token_a: values.takerAccountA,
            taker_token_b: values.takerAccountB,
            payer: payer.publicKey,
            programId: values.programId,
        });

        const tx = new Transaction();
        tx.recentBlockhash = context.lastBlockhash;
        tx.add(ix).sign(payer, values.taker);
        await client.processTransaction(tx);

        const offerInfo = await client.getAccount(values.offer);
        assert(offerInfo === null, 'offer account not closed');

        const vaultInfo = await client.getAccount(values.vault);
        assert(vaultInfo === null, 'vault account not closed');

        const makerTokenBInfo = await client.getAccount(values.makerAccountB);
        if (makerTokenBInfo === null) throw new Error('Maker token B account not found');
        const makerTokenAccountB = AccountLayout.decode(makerTokenBInfo.data);

        const takerTokenAInfo = await client.getAccount(values.takerAccountA);
        if (takerTokenAInfo === null) throw new Error('Taker token A account not found');
        const takerTokenAccountA = AccountLayout.decode(takerTokenAInfo.data);

        assert(takerTokenAccountA.amount.toString() === values.amountA.toString(), 'unexpected amount a');
        assert(makerTokenAccountB.amount.toString() === values.amountB.toString(), 'unexpected amount b');
    });
});
