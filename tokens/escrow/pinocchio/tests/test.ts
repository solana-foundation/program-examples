import { AccountLayout } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { type OfferRaw, OfferSchema } from './account';
import { buildMakeOffer, buildTakeOffer } from './instruction';
import { createValues, mintingTokens } from './utils';

describe('Escrow (Pinocchio)', () => {
    const values = createValues();

    const svm = new LiteSVM();
    svm.addProgramFromFile(values.programId, 'tests/fixtures/escrow_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    // Fund the maker with token A and the taker with token B before trading.
    mintingTokens({ svm, payer, holder: values.maker, mintKeypair: values.mintAKeypair });
    mintingTokens({ svm, payer, holder: values.taker, mintKeypair: values.mintBKeypair });

    it('Makes an offer', () => {
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
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, values.maker);
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const offerInfo = svm.getAccount(values.offer);
        if (offerInfo === null) throw new Error('Offer account not found');
        const offer = borsh.deserialize(OfferSchema, Buffer.from(offerInfo.data)) as OfferRaw;

        const vaultInfo = svm.getAccount(values.vault);
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

    it('Takes the offer', () => {
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
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, values.taker);
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const offerInfo = svm.getAccount(values.offer);
        assert(offerInfo === null, 'offer account not closed');

        const vaultInfo = svm.getAccount(values.vault);
        assert(vaultInfo === null, 'vault account not closed');

        const makerTokenBInfo = svm.getAccount(values.makerAccountB);
        if (makerTokenBInfo === null) throw new Error('Maker token B account not found');
        const makerTokenAccountB = AccountLayout.decode(makerTokenBInfo.data);

        const takerTokenAInfo = svm.getAccount(values.takerAccountA);
        if (takerTokenAInfo === null) throw new Error('Taker token A account not found');
        const takerTokenAccountA = AccountLayout.decode(takerTokenAInfo.data);

        assert(takerTokenAccountA.amount.toString() === values.amountA.toString(), 'unexpected amount a');
        assert(makerTokenAccountB.amount.toString() === values.amountB.toString(), 'unexpected amount b');
    });
});
