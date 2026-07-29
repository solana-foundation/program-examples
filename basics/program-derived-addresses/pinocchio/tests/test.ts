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
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('PDAs', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testUser: KeyPairSigner;
    let pageVisitsPda: Address;
    let pageVisitsBump: number;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/program_derived_addresses_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        testUser = await generateKeyPairSigner();
        [pageVisitsPda, pageVisitsBump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['page_visits', getAddressEncoder().encode(testUser.address)],
        });
    });

    async function sendInstruction(ix: Instruction) {
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

    function readPageVisits(): number {
        const account = svm.getAccount(pageVisitsPda);
        assert(account.exists, 'page visits account not found');
        return Buffer.from(account.data).readUInt32LE(0);
    }

    function incrementInstruction(): Instruction {
        return {
            programAddress: programId,
            accounts: [{ address: pageVisitsPda, role: AccountRole.WRITABLE }],
            data: new Uint8Array([1]),
        };
    }

    it('Create a test user', async () => {
        const ix = getCreateAccountInstruction({
            payer,
            newAccount: testUser,
            lamports: svm.minimumBalanceForRentExemption(0n),
            space: 0,
            programAddress: SYSTEM_PROGRAM_ADDRESS,
        });

        await sendInstruction(ix);
    });

    it('Create the page visits tracking PDA', async () => {
        const data = Buffer.alloc(6);
        data.writeUInt8(0, 0);
        data.writeUInt32LE(0, 1);
        data.writeUInt8(pageVisitsBump, 5);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: pageVisitsPda, role: AccountRole.WRITABLE },
                { address: testUser.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(data),
        };

        await sendInstruction(ix);

        const account = svm.getAccount(pageVisitsPda);
        assert(account.exists, 'page visits account not found');
        assert.strictEqual(account.programAddress, programId);
        assert.strictEqual(account.data.length, 5);
        assert.strictEqual(readPageVisits(), 0);
    });

    it('Visit the page!', async () => {
        await sendInstruction(incrementInstruction());

        assert.strictEqual(readPageVisits(), 1);
    });

    it('Visit the page again!', async () => {
        svm.expireBlockhash();
        await sendInstruction(incrementInstruction());

        assert.strictEqual(readPageVisits(), 2);
    });
});
