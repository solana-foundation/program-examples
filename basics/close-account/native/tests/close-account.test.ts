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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createCloseUserInstruction, createCreateUserInstruction, userDecoder } from '../ts';

describe('Close Account!', () => {
    const svm = new LiteSVM();
    const userName = 'Jacob';
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
        const ix = createCreateUserInstruction(testAccountAddress, payer, programId, userName);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(testAccountAddress);
        assert(account.exists);
        assert.equal(account.programAddress, programId);
        assert.equal(userDecoder.decode(account.data).name, userName);
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

        // Closing resizes the account to zero and hands ownership back to the
        // System Program, leaving only the rent-exempt minimum for a 0-byte account.
        const account = svm.getAccount(testAccountAddress);
        assert(account.exists);
        assert.equal(account.programAddress, SYSTEM_PROGRAM_ADDRESS);
        assert.equal(account.data.length, 0);
    });
});
