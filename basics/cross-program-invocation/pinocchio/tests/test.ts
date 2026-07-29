import { Buffer } from 'node:buffer';
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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Pinocchio: CPI', () => {
    const svm = new LiteSVM();
    let handProgramId: Address;
    let leverProgramId: Address;
    let payer: KeyPairSigner;
    let powerAccount: KeyPairSigner;

    // Lever instruction discriminator
    const IX_INITIALIZE = 0;

    before(async () => {
        handProgramId = (await generateKeyPairSigner()).address;
        leverProgramId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(handProgramId, 'tests/fixtures/cross_program_invocation_pinocchio_hand.so');
        svm.addProgramFromFile(leverProgramId, 'tests/fixtures/cross_program_invocation_pinocchio_lever.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        powerAccount = await generateKeyPairSigner();
    });

    async function sendTx(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        return svm.sendTransaction(signedTx);
    }

    it('Initialize the lever!', async () => {
        const ix = {
            programAddress: leverProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: powerAccount },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array([IX_INITIALIZE]),
        };
        const result = await sendTx(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.address);
        if (!acct.exists) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false
    });

    it('Pull the lever!', async () => {
        const name = 'Chris';
        const ix = {
            programAddress: handProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE },
                { address: leverProgramId, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.from(name, 'utf8')),
        };
        const result = await sendTx(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.address);
        if (!acct.exists) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([1])); // is_on = true
    });

    it('Pull it again!', async () => {
        const name = 'Ashley';
        const ix = {
            programAddress: handProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE },
                { address: leverProgramId, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.from(name, 'utf8')),
        };
        const result = await sendTx(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const acct = svm.getAccount(powerAccount.address);
        if (!acct.exists) throw new Error('power account not found');
        assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false (flipped back)
    });

    it('Lever rejects switch_power directly with no name', async () => {
        // Sending only the discriminator (no name bytes) is fine because UTF-8 of empty is empty,
        // but invoking the lever directly with an unknown discriminator should fail.
        const ix = {
            programAddress: leverProgramId,
            accounts: [{ address: powerAccount.address, role: AccountRole.WRITABLE }],
            data: new Uint8Array([42]),
        };

        const result = await sendTx(ix);
        assert.instanceOf(result, FailedTransactionMetadata, 'expected lever to reject unknown discriminator');
    });
});
