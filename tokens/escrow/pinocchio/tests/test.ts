import { generateKeyPairSigner, getAddressDecoder, type KeyPairSigner, lamports } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
    getInitializeAccount3Instruction,
    getTokenDecoder,
    getTokenSize,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import { type OfferRaw, OfferSchema } from './account';
import { buildMakeOffer, buildRefundOffer, buildTakeOffer } from './instruction';
import { createValues, expectRevert, mintingTokens, sendInstructions, type TestValues } from './utils';

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

    it('Take Offer rejects a substitute vault account', async () => {
        // Regression test: take_offer used to trust whatever account was
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
            id: 3n,
        });

        await sendInstructions(svm, payer, [
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                bump: offerValues.offerBump,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        ]);

        // Create a decoy token-A account owned by the offer PDA - NOT the
        // canonical ATA, so it's a different address than offerValues.vault.
        const decoyVault = await generateKeyPairSigner();
        const tokenSize = BigInt(getTokenSize());
        await sendInstructions(svm, payer, [
            getCreateAccountInstruction({
                payer,
                newAccount: decoyVault,
                space: tokenSize,
                lamports: svm.minimumBalanceForRentExemption(tokenSize),
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
        ]);
        await sendInstructions(svm, payer, [
            getInitializeAccount3Instruction({
                account: decoyVault.address,
                mint: offerValues.mintAKeypair.address,
                owner: offerValues.offer,
            }),
        ]);

        await expectRevert(
            sendInstructions(svm, payer, [
                buildTakeOffer({
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
                }),
            ]),
        );
    });

    it('Refund Offer returns the vaulted tokens to the maker', async () => {
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 1n,
        });

        await sendInstructions(svm, payer, [
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                bump: offerValues.offerBump,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        ]);

        const makerTokenAInfoBefore = svm.getAccount(offerValues.makerAccountA);
        if (!makerTokenAInfoBefore.exists) throw new Error('Maker token A account not found');
        const makerTokenAccountABefore = getTokenDecoder().decode(makerTokenAInfoBefore.data);

        await sendInstructions(svm, payer, [
            buildRefundOffer({
                offer: offerValues.offer,
                mint_a: offerValues.mintAKeypair.address,
                maker_token_a: offerValues.makerAccountA,
                vault: offerValues.vault,
                maker: offerValues.maker,
                programId: offerValues.programId,
            }),
        ]);

        const offerInfo = svm.getAccount(offerValues.offer);
        assert(!offerInfo.exists, 'offer account not closed');

        const vaultInfo = svm.getAccount(offerValues.vault);
        assert(!vaultInfo.exists, 'vault account not closed');

        const makerTokenAInfoAfter = svm.getAccount(offerValues.makerAccountA);
        if (!makerTokenAInfoAfter.exists) throw new Error('Maker token A account not found');
        const makerTokenAccountAAfter = getTokenDecoder().decode(makerTokenAInfoAfter.data);
        assert(
            makerTokenAccountAAfter.amount === makerTokenAccountABefore.amount + offerValues.amountA,
            'refunded amount not credited back to the maker',
        );
    });

    it('Refund Offer rejects a non-maker signer', async () => {
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 2n,
        });

        await sendInstructions(svm, payer, [
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                bump: offerValues.offerBump,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        ]);

        // The taker attempts to refund the maker's offer to their own account.
        await expectRevert(
            sendInstructions(svm, payer, [
                buildRefundOffer({
                    offer: offerValues.offer,
                    mint_a: offerValues.mintAKeypair.address,
                    maker_token_a: offerValues.takerAccountA,
                    vault: offerValues.vault,
                    maker: offerValues.taker,
                    programId: offerValues.programId,
                }),
            ]),
        );
    });

    it('Refund Offer rejects a substitute vault account', async () => {
        // Same class of bug as the Take Offer regression above, in
        // refund_offer's own vault.
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 4n,
        });

        await sendInstructions(svm, payer, [
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                bump: offerValues.offerBump,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        ]);

        const decoyVault = await generateKeyPairSigner();
        const tokenSize = BigInt(getTokenSize());
        await sendInstructions(svm, payer, [
            getCreateAccountInstruction({
                payer,
                newAccount: decoyVault,
                space: tokenSize,
                lamports: svm.minimumBalanceForRentExemption(tokenSize),
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
        ]);
        await sendInstructions(svm, payer, [
            getInitializeAccount3Instruction({
                account: decoyVault.address,
                mint: offerValues.mintAKeypair.address,
                owner: offerValues.offer,
            }),
        ]);

        await expectRevert(
            sendInstructions(svm, payer, [
                buildRefundOffer({
                    offer: offerValues.offer,
                    mint_a: offerValues.mintAKeypair.address,
                    maker_token_a: offerValues.makerAccountA,
                    vault: decoyVault.address,
                    maker: offerValues.maker,
                    programId: offerValues.programId,
                }),
            ]),
        );
    });

    it('Refund Offer rejects a substitute maker_token_account_a', async () => {
        // Regression test: refund_offer used to trust whatever account was
        // passed as `maker_token_account_a` (the refund destination) without
        // verifying it's the maker's actual canonical ATA - only the vault
        // was checked. A malicious or compromised client could redirect the
        // refund to an attacker-controlled account while the maker still
        // signs, unaware the destination was swapped.
        const offerValues = await createValues({
            programId: values.programId,
            maker: values.maker,
            taker: values.taker,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
            id: 5n,
        });

        await sendInstructions(svm, payer, [
            buildMakeOffer({
                id: offerValues.id,
                maker: offerValues.maker,
                maker_token_a: offerValues.makerAccountA,
                offer: offerValues.offer,
                bump: offerValues.offerBump,
                token_a_offered_amount: offerValues.amountA,
                token_b_wanted_amount: offerValues.amountB,
                vault: offerValues.vault,
                mint_a: offerValues.mintAKeypair.address,
                mint_b: offerValues.mintBKeypair.address,
                payer,
                programId: offerValues.programId,
            }),
        ]);

        // Substitute the taker's (unrelated) token A account as the refund
        // destination instead of the maker's own canonical ATA.
        await expectRevert(
            sendInstructions(svm, payer, [
                buildRefundOffer({
                    offer: offerValues.offer,
                    mint_a: offerValues.mintAKeypair.address,
                    maker_token_a: offerValues.takerAccountA,
                    vault: offerValues.vault,
                    maker: offerValues.maker,
                    programId: offerValues.programId,
                }),
            ]),
        );
    });
});
