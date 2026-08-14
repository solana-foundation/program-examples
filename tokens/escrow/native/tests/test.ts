import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import {
    getCreateAssociatedTokenIdempotentInstruction,
    getInitializeAccount3Instruction,
    getMintToInstruction,
    getTokenDecoder,
    getTokenSize,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getCreateAccountInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { offerDecoder } from './account';
import { buildMakeOffer, buildRefundOffer, buildTakeOffer } from './instruction';
import { createValues, type TestValues, mintingTokens } from './utils';

const LAMPORTS_PER_SOL = 1_000_000_000n;

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
        const offer = offerDecoder.decode(offerInfo.data);

        const vaultInfo = svm.getAccount(values.vault);
        assert(vaultInfo.exists, 'vault account not created');
        const vaultTokenAccount = getTokenDecoder().decode(vaultInfo.data);

        assert(offer.id.toString() === values.id.toString(), 'wrong id');
        assert(offer.maker === values.maker.address, 'maker key does not match');
        assert(offer.token_mint_a === values.mintAKeypair.address, 'wrong mint A');
        assert(offer.token_mint_b === values.mintBKeypair.address, 'wrong mint B');
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

    it("Take Offer succeeds even if the maker's receiving account already has a balance", async () => {
        // Regression test: take_offer used to compare the maker's post-transfer
        // token B balance against the wrong pre-transfer variable, so the
        // instruction only worked by coincidence when the maker's token B
        // account started at exactly 0. Any third party could permanently
        // brick an offer for free by creating the maker's token B ATA and
        // sending it 1 base unit before a take - both permissionless, no
        // signature required from the maker. This offer's maker_token_b
        // account is pre-funded before Take Offer runs to reproduce exactly
        // that condition.
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 1n,
        });

        await sendTransaction(
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        );

        // Pre-fund the maker's token B account with a small existing balance -
        // this is exactly what a griefing third party (or a maker who simply
        // already held some of the wanted token) would produce. This ATA is
        // shared with the maker's other offers (same maker + mint B), so it
        // may already carry a balance from earlier tests too - either way,
        // the point is that it's nonzero before this Take Offer runs.
        const dustAmount = 1n;
        await sendTransaction(
            getCreateAssociatedTokenIdempotentInstruction({
                payer,
                ata: offerValues.makerAccountB,
                owner: offerValues.maker.address,
                mint: offerValues.mintBKeypair.address,
            }),
        );
        await sendTransaction(
            getMintToInstruction({
                mint: offerValues.mintBKeypair.address,
                token: offerValues.makerAccountB,
                mintAuthority: payer,
                amount: dustAmount,
            }),
        );

        const makerTokenBInfoBefore = svm.getAccount(offerValues.makerAccountB);
        assert(makerTokenBInfoBefore.exists, 'maker token B account does not exist');
        const makerTokenAccountBBefore = getTokenDecoder().decode(makerTokenBInfoBefore.data);
        assert(makerTokenAccountBBefore.amount > 0n, "maker's token B account should be nonzero before Take Offer");

        const ix = buildTakeOffer({
            maker: offerValues.maker.address,
            offer: offerValues.offer,
            vault: offerValues.vault,
            mint_a: offerValues.mintAKeypair.address,
            mint_b: offerValues.mintBKeypair.address,
            maker_token_b: offerValues.makerAccountB,
            taker: offerValues.taker,
            taker_token_a: offerValues.takerAccountA,
            taker_token_b: offerValues.takerAccountB,
            payer,
            programId: offerValues.programId,
        });

        await sendTransaction(ix);

        const makerTokenBInfo = svm.getAccount(offerValues.makerAccountB);
        assert(makerTokenBInfo.exists, 'maker token B account does not exist');
        const makerTokenAccountB = getTokenDecoder().decode(makerTokenBInfo.data);
        assert(
            makerTokenAccountB.amount.toString() === (makerTokenAccountBBefore.amount + offerValues.amountB).toString(),
            'maker token B balance should be its pre-existing balance plus the wanted amount',
        );
    });

    it('Take Offer rejects a substitute vault account', async () => {
        // Same class of bug as the "Refund Offer rejects a substitute vault
        // account" regression below, but in take_offer: it also trusted
        // whatever account was passed as `vault` without verifying it's
        // actually the offer's canonical ATA.
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 5n,
        });

        await sendTransaction(
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        );

        // Create a decoy token-A account owned by the offer PDA - NOT the
        // canonical ATA, so it's a different address than offerValues.vault.
        const decoyVault = await generateKeyPairSigner();
        const tokenSize = BigInt(getTokenSize());
        await sendTransaction(
            getCreateAccountInstruction({
                payer,
                newAccount: decoyVault,
                space: tokenSize,
                lamports: svm.minimumBalanceForRentExemption(tokenSize),
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
        );
        await sendTransaction(
            getInitializeAccount3Instruction({
                account: decoyVault.address,
                mint: offerValues.mintAKeypair.address,
                owner: offerValues.offer,
            }),
        );

        const ix = buildTakeOffer({
            maker: offerValues.maker.address,
            offer: offerValues.offer,
            vault: decoyVault.address,
            mint_a: offerValues.mintAKeypair.address,
            mint_b: offerValues.mintBKeypair.address,
            maker_token_b: offerValues.makerAccountB,
            taker: offerValues.taker,
            taker_token_a: offerValues.takerAccountA,
            taker_token_b: offerValues.takerAccountB,
            payer,
            programId: offerValues.programId,
        });

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(result instanceof FailedTransactionMetadata, 'expected a take against a substitute vault to fail');
    });

    it('Refund Offer returns the vaulted tokens to the maker', async () => {
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 2n,
        });

        await sendTransaction(
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        );

        const makerTokenAInfoBefore = svm.getAccount(offerValues.makerAccountA);
        assert(makerTokenAInfoBefore.exists, 'maker token A account does not exist');
        const makerTokenAccountABefore = getTokenDecoder().decode(makerTokenAInfoBefore.data);

        const ix = buildRefundOffer({
            offer: offerValues.offer,
            mint_a: offerValues.mintAKeypair.address,
            maker_token_a: offerValues.makerAccountA,
            vault: offerValues.vault,
            maker: offerValues.maker,
            programId: offerValues.programId,
        });

        await sendTransaction(ix);

        const offerInfo = svm.getAccount(offerValues.offer);
        assert(!offerInfo.exists, 'offer account not closed');

        const vaultInfo = svm.getAccount(offerValues.vault);
        assert(!vaultInfo.exists, 'vault account not closed');

        const makerTokenAInfoAfter = svm.getAccount(offerValues.makerAccountA);
        assert(makerTokenAInfoAfter.exists, 'maker token A account does not exist');
        const makerTokenAccountAAfter = getTokenDecoder().decode(makerTokenAInfoAfter.data);
        assert(
            makerTokenAccountAAfter.amount.toString() ===
                (makerTokenAccountABefore.amount + offerValues.amountA).toString(),
            'refunded amount not credited back to the maker',
        );
    });

    it('Refund Offer rejects a substitute vault account', async () => {
        // Regression test: refund_offer used to trust whatever account was
        // passed as `vault` without verifying it's actually the offer's
        // canonical ATA. Any token-A account with owner = the offer PDA
        // (creatable by anyone, without the PDA's cooperation - a token
        // account's owner field never needs the owner to sign at creation
        // time) could be substituted, draining that decoy instead of the
        // real vault and then closing the offer anyway - permanently
        // stranding the real vault's funds.
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 4n,
        });

        await sendTransaction(
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        );

        // Create a decoy token-A account owned by the offer PDA - NOT the
        // canonical ATA, so it's a different address than offerValues.vault.
        const decoyVault = await generateKeyPairSigner();
        const tokenSize = BigInt(getTokenSize());
        await sendTransaction(
            getCreateAccountInstruction({
                payer,
                newAccount: decoyVault,
                space: tokenSize,
                lamports: svm.minimumBalanceForRentExemption(tokenSize),
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
        );
        await sendTransaction(
            getInitializeAccount3Instruction({
                account: decoyVault.address,
                mint: offerValues.mintAKeypair.address,
                owner: offerValues.offer,
            }),
        );

        const ix = buildRefundOffer({
            offer: offerValues.offer,
            mint_a: offerValues.mintAKeypair.address,
            maker_token_a: offerValues.makerAccountA,
            vault: decoyVault.address,
            maker: offerValues.maker,
            programId: offerValues.programId,
        });

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(result instanceof FailedTransactionMetadata, 'expected a refund against a substitute vault to fail');
    });

    it('Refund Offer rejects a non-maker signer', async () => {
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 3n,
        });

        await sendTransaction(
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        );

        // The taker attempts to refund the maker's offer to their own account.
        const ix = buildRefundOffer({
            offer: offerValues.offer,
            mint_a: offerValues.mintAKeypair.address,
            maker_token_a: offerValues.takerAccountA,
            vault: offerValues.vault,
            maker: offerValues.taker,
            programId: offerValues.programId,
        });

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(result instanceof FailedTransactionMetadata, 'expected a non-maker refund to fail');
    });
});
