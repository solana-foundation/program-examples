import { Buffer } from 'node:buffer';
import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressDecoder,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getTokenDecoder } from '@solana-program/token';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { type OfferRaw, OfferSchema } from './account';
import { buildMakeOffer, buildTakeOffer } from './instruction';
import { createValues, type TestValues, mintingTokens } from './utils';

const LAMPORTS_PER_SOL = 1_000_000_000n;

const addressDecoder = getAddressDecoder();

describe('Escrow!', () => {
    const svm = new LiteSVM();
    let values: TestValues;
    let payer: KeyPairSigner;

    before(async () => {
        values = await createValues();

        svm.addProgramFromFile(values.programId, 'tests/fixtures/escrow_native_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(LAMPORTS_PER_SOL));

        console.log(`Program Address    : ${values.programId}`);
        console.log(`Payer Address      : ${payer.address}`);
    });

    async function sendTransaction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('mint tokens to maker and taker', async () => {
        // mint token a to maker account
        await mintingTokens({
            svm,
            payer,
            holder: values.maker,
            mintKeypair: values.mintAKeypair,
        });

        // mint Token B to Taker account
        await mintingTokens({
            svm,
            payer,
            holder: values.taker,
            mintKeypair: values.mintBKeypair,
        });
    });

    it('Make Offer', async () => {
        const ix = buildMakeOffer({
            id: values.id,
            maker: values.maker,
            maker_token_a: values.makerAccountA,
            offer: values.offer,
            token_a_offered_amount: values.amountA,
            token_b_wanted_amount: values.amountB,
            vault: values.vault,
            mint_a: values.mintAKeypair.address,
            mint_b: values.mintBKeypair.address,
            payer,
            programId: values.programId,
        });

        await sendTransaction(ix);

        const offerInfo = svm.getAccount(values.offer);
        assert(offerInfo.exists, 'offer account not created');
        const offer = borsh.deserialize(OfferSchema, Buffer.from(offerInfo.data)) as OfferRaw;

        const vaultInfo = svm.getAccount(values.vault);
        assert(vaultInfo.exists, 'vault account not created');
        const vaultTokenAccount = getTokenDecoder().decode(vaultInfo.data);

        assert(offer.id.toString() === values.id.toString(), 'wrong id');
        // borsh deserializes pubkeys as raw byte arrays, decode them into addresses for comparison
        assert(addressDecoder.decode(offer.maker) === values.maker.address, 'maker key does not match');
        assert(addressDecoder.decode(offer.token_mint_a) === values.mintAKeypair.address, 'wrong mint A');
        assert(addressDecoder.decode(offer.token_mint_b) === values.mintBKeypair.address, 'wrong mint B');
        assert(offer.token_b_wanted_amount.toString() === values.amountB.toString(), 'unexpected amount B');
        assert(vaultTokenAccount.amount.toString() === values.amountA.toString(), 'unexpected amount A');
    });

    it('Take Offer', async () => {
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

        await sendTransaction(ix);

        const offerInfo = svm.getAccount(values.offer);
        assert(!offerInfo.exists, 'offer account not closed');

        const vaultInfo = svm.getAccount(values.vault);
        assert(!vaultInfo.exists, 'vault account not closed');

        const makerTokenBInfo = svm.getAccount(values.makerAccountB);
        assert(makerTokenBInfo.exists, 'maker token B account does not exist');
        const makerTokenAccountB = getTokenDecoder().decode(makerTokenBInfo.data);

        const takerTokenAInfo = svm.getAccount(values.takerAccountA);
        assert(takerTokenAInfo.exists, 'taker token A account does not exist');
        const takerTokenAccountA = getTokenDecoder().decode(takerTokenAInfo.data);

        assert(takerTokenAccountA.amount.toString() === values.amountA.toString(), 'unexpected amount a');
        assert(makerTokenAccountB.amount.toString() === values.amountB.toString(), 'unexpected amount b');
    });
});
