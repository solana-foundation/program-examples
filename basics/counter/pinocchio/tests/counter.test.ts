import {
    AccountRole,
    type Address,
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
import { getCreateAccountInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const COUNTER_ACCOUNT_SIZE = 8;
const INCREMENT_DISCRIMINATOR = 0;

describe('Counter Solana Pinocchio', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let counterKeypair: KeyPairSigner;
    let counter: Address;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/counter_solana_pinocchio.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        counterKeypair = await generateKeyPairSigner();
        counter = counterKeypair.address;
    });

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        return svm.sendTransaction(signedTx);
    }

    function readCount(): bigint {
        const account = svm.getAccount(counter);
        assert(account.exists, 'expected counter account to exist');
        assert.equal(account.data.length, COUNTER_ACCOUNT_SIZE);
        return Buffer.from(account.data).readBigUInt64LE(0);
    }

    it('Create the counter account', async () => {
        const rent = svm.getRent();
        const ix = getCreateAccountInstruction({
            payer,
            newAccount: counterKeypair,
            lamports: rent.minimumBalance(BigInt(COUNTER_ACCOUNT_SIZE)),
            space: COUNTER_ACCOUNT_SIZE,
            programAddress: programId,
        });

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(readCount(), 0n);
    });

    it('Increment the counter', async () => {
        const ix = {
            programAddress: programId,
            accounts: [{ address: counter, role: AccountRole.WRITABLE }],
            data: new Uint8Array([INCREMENT_DISCRIMINATOR]),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(readCount(), 1n);
    });
});
