import { generateKeyPairSigner, getAddressDecoder, type KeyPairSigner, lamports } from '@solana/kit';
import { getTokenDecoder } from '@solana-program/token';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import { type OfferRaw, OfferSchema } from './account';
import { buildMakeOffer, buildTakeOffer } from './instruction';
import { createValues, mintingTokens, sendInstructions, type TestValues } from './utils';

const addressDecoder = getAddressDecoder();

describe('Escrow (Pinocchio)', () => {
    let svm: LiteSVM;
    let payer: KeyPairSigner;
    let values: TestValues;

    before(async () => {
        values = await createValues();

        svm = new LiteSVM();
        svm.addProgramFromFile(values.programId, 'tests/fixtures/escrow_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Fund the maker with token A and the taker with token B before trading.
        await mintingTokens({ svm, payer, holder: values.maker, mintKeypair: values.mintAKeypair });
        await mintingTokens({ svm, payer, holder: values.taker, mintKeypair: values.mintBKeypair });
    });

    it('Makes an offer', async () => {
        const ix = buildMakeOffer({
            id: values.id,
            maker: values.maker,
            maker_token_a: values.makerAccountA,
            offer: values.offer,
            bump: values.offerBump,
            token_a_offered_amount: values.amountA,
            token_b_wanted_amount: values.amountB,
            vault: values.vault,
            mint_a: values.mintAKeypair.address,
            mint_b: values.mintBKeypair.address,
            payer,
            programId: values.programId,
        });

        await sendInstructions(svm, payer, [ix]);

        const offerInfo = svm.getAccount(values.offer);
        if (!offerInfo.exists) throw new Error('Offer account not found');
        const offer = borsh.deserialize(OfferSchema, new Uint8Array(offerInfo.data)) as OfferRaw;

        const vaultInfo = svm.getAccount(values.vault);
        if (!vaultInfo.exists) throw new Error('Vault account not found');
        const vaultTokenAccount = getTokenDecoder().decode(vaultInfo.data);

        assert(offer.id === values.id, 'wrong id');
        // borsh deserializes pubkeys as raw byte arrays, decode into addresses for comparison
        assert(
            addressDecoder.decode(Uint8Array.from(offer.maker)) === values.maker.address,
            'maker key does not match',
        );
        assert(
            addressDecoder.decode(Uint8Array.from(offer.token_mint_a)) === values.mintAKeypair.address,
            'wrong mint A',
        );
        assert(
            addressDecoder.decode(Uint8Array.from(offer.token_mint_b)) === values.mintBKeypair.address,
            'wrong mint B',
        );
        assert(offer.token_b_wanted_amount === values.amountB, 'unexpected amount B');
        assert(vaultTokenAccount.amount === values.amountA, 'unexpected amount A');
    });

    it('Takes the offer', async () => {
        const ix = buildTakeOffer({
            maker: values.maker.address,
            offer: values.offer,
            vault: values.vault,
            mint_a: values.mintAKeypair.address,
            mint_b: values.mintBKeypair.address,
            maker_token_b: values.makerAccountB,
            taker: values.taker,
            taker_token_a: values.takerAccountA,
            taker_token_b: values.takerAccountB,
            payer,
            programId: values.programId,
        });

        await sendInstructions(svm, payer, [ix]);

        const offerInfo = svm.getAccount(values.offer);
        assert(!offerInfo.exists, 'offer account not closed');

        const vaultInfo = svm.getAccount(values.vault);
        assert(!vaultInfo.exists, 'vault account not closed');

        const makerTokenBInfo = svm.getAccount(values.makerAccountB);
        if (!makerTokenBInfo.exists) throw new Error('Maker token B account not found');
        const makerTokenAccountB = getTokenDecoder().decode(makerTokenBInfo.data);

        const takerTokenAInfo = svm.getAccount(values.takerAccountA);
        if (!takerTokenAInfo.exists) throw new Error('Taker token A account not found');
        const takerTokenAccountA = getTokenDecoder().decode(takerTokenAInfo.data);

        assert(takerTokenAccountA.amount === values.amountA, 'unexpected amount a');
        assert(makerTokenAccountB.amount === values.amountB, 'unexpected amount b');
    });
});
