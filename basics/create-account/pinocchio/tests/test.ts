import assert from 'node:assert';
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
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Create a system account', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/create_account_pinocchio_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(2_000_000_000n));
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

    it('Create the account via a cross program invocation', async () => {
        const newKeypair = await generateKeyPairSigner();

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: newKeypair.address, role: AccountRole.WRITABLE_SIGNER, signer: newKeypair },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(512),
        };

        const result = await sendInstruction(ix);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        // Verify the account was created with space derived from the instruction data
        const accountInfo = svm.getAccount(newKeypair.address);
        if (!accountInfo.exists || accountInfo.data.length !== 512) throw new Error('unexpected account size');
    });

    it('Create the account via direct call to system program', async () => {
        const newKeypair = await generateKeyPairSigner();

        const ix = getCreateAccountInstruction({
            payer,
            newAccount: newKeypair,
            lamports: 1_000_000_000n,
            space: 0,
            programAddress: SYSTEM_PROGRAM_ADDRESS,
        });

        const result = await sendInstruction(ix);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
        console.log(`Account with public key ${newKeypair.address} successfully created`);
    });
});
