import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import {
    AccountRole,
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
import * as borsh from 'borsh';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

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

    const PageVisitsSchema = {
        struct: {
            page_visits: 'u32',
            bump: 'u8',
        },
    };

    // Empty struct — just needs to serialize to zero bytes
    const IncrementPageVisitsSchema = { struct: {} };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

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
        const ix = {
            programAddress: programId,
            accounts: [
                { address: pageVisitsPda, role: AccountRole.WRITABLE },
                { address: testUser.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                borshSerialize(PageVisitsSchema, {
                    page_visits: 0,
                    bump: pageVisitsBump,
                }),
            ),
        };

        await sendTransaction(ix);
    });

    it('Visit the page!', async () => {
        const [pageVisitsPda, _] = await derivePageVisitsPda(testUser.address);
        const ix = {
            programAddress: programId,
            accounts: [
                { address: pageVisitsPda, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            ],
            data: new Uint8Array(borshSerialize(IncrementPageVisitsSchema, {})),
        };

        await sendTransaction(ix);
    });

    it('Visit the page!', async () => {
        const [pageVisitsPda, _] = await derivePageVisitsPda(testUser.address);
        const ix = {
            programAddress: programId,
            accounts: [
                { address: pageVisitsPda, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            ],
            data: new Uint8Array(borshSerialize(IncrementPageVisitsSchema, {})),
        };

        svm.expireBlockhash();
        await sendTransaction(ix);
    });

    it('Read page visits', async () => {
        const [pageVisitsPda, _] = await derivePageVisitsPda(testUser.address);
        const accountInfo = svm.getAccount(pageVisitsPda);
        assert(accountInfo.exists, 'page visits account not found');
        const readPageVisits = borsh.deserialize(PageVisitsSchema, Buffer.from(accountInfo.data)) as {
            page_visits: number;
            bump: number;
        };
        console.log(`Number of page visits: ${readPageVisits.page_visits}`);
    });
});
