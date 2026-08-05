import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createCloseUserInstruction, createCreateUserInstruction } from '../ts';

describe('Close Account!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testAccountAddress: Address;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/close_account_native_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        [testAccountAddress] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['USER', getAddressEncoder().encode(payer.address)],
        });
    });

    it('Create the account', async () => {
        const ix = createCreateUserInstruction(testAccountAddress, payer, programId, 'Jacob');

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    it("An attacker cannot close another user's account", async () => {
        // The attacker signs with their own key, but passes the victim's
        // (payer's) User PDA as the account to close. Without a check that
        // the target PDA actually belongs to the signer, this would drain
        // the victim's account into the attacker's.
        const attacker = await generateKeyPairSigner();
        svm.airdrop(attacker.address, lamports(1_000_000_000n));

        const ix = createCloseUserInstruction(testAccountAddress, attacker, programId);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(attacker, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(result instanceof FailedTransactionMetadata, 'expected the attacker transaction to fail');
        assert.include(
            result.err().toString(),
            'IncorrectProgramId',
            `expected the attacker's target PDA to be rejected as not belonging to them, got: ${result.toString()}`,
        );
    });

    it('Close the account', async () => {
        const ix = createCloseUserInstruction(testAccountAddress, payer, programId);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
