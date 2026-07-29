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

describe('Checking accounts', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let rentExemptBalance: bigint;

    // We'll create this ahead of time.
    // Our program will try to modify it.
    let accountToChange: KeyPairSigner;
    // Our program will create this.
    let accountToCreate: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/checking_accounts_pinocchio_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        rentExemptBalance = svm.minimumBalanceForRentExemption(0n);

        accountToChange = await generateKeyPairSigner();
        accountToCreate = await generateKeyPairSigner();
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

    it('Create an account owned by our program', async () => {
        const ix = getCreateAccountInstruction({
            payer,
            newAccount: accountToChange,
            lamports: rentExemptBalance,
            space: 0,
            programAddress: programId, // Our program
        });

        const result = await sendInstruction(ix);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    it('Check accounts', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: accountToCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: accountToCreate },
                { address: accountToChange.address, role: AccountRole.WRITABLE_SIGNER, signer: accountToChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        const result = await sendInstruction(ix);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
