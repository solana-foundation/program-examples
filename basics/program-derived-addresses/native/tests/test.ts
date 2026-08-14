import assert from 'node:assert';
import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createCreatePageVisitsInstruction, createIncrementPageVisitsInstruction, pageVisitsDecoder } from '../ts';

describe('PDAs', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testUser: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/program_derived_addresses_native_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        testUser = await generateKeyPairSigner();
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

    it('Create a test user', async () => {
        const ix = getCreateAccountInstruction({
            payer,
            newAccount: testUser,
            lamports: svm.minimumBalanceForRentExemption(0n),
            space: 0,
            programAddress: SYSTEM_PROGRAM_ADDRESS,
        });

        await sendTransaction(ix);
        console.log(`Local Wallet: ${payer.address}`);
        console.log(`Created User: ${testUser.address}`);
    });

    function derivePageVisitsPda(userAddress: Address) {
        return getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['page_visits', getAddressEncoder().encode(userAddress)],
        });
    }

    it('Create the page visits tracking PDA', async () => {
        const [pageVisitsPda, pageVisitsBump] = await derivePageVisitsPda(testUser.address);
        const ix = createCreatePageVisitsInstruction(pageVisitsPda, testUser.address, payer, programId, pageVisitsBump);

        await sendTransaction(ix);
    });

    it('Visit the page!', async () => {
        const [pageVisitsPda] = await derivePageVisitsPda(testUser.address);
        const ix = createIncrementPageVisitsInstruction(pageVisitsPda, payer, programId);

        await sendTransaction(ix);
    });

    it('Visit the page!', async () => {
        const [pageVisitsPda] = await derivePageVisitsPda(testUser.address);
        const ix = createIncrementPageVisitsInstruction(pageVisitsPda, payer, programId);

        svm.expireBlockhash();
        await sendTransaction(ix);
    });

    it('Read page visits', async () => {
        const [pageVisitsPda] = await derivePageVisitsPda(testUser.address);
        const accountInfo = svm.getAccount(pageVisitsPda);
        assert(accountInfo.exists, 'page visits account not found');
        const readPageVisits = pageVisitsDecoder.decode(accountInfo.data);
        console.log(`Number of page visits: ${readPageVisits.pageVisits}`);
    });
});
