import assert from 'node:assert';
import {
    AccountRole,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressDecoder,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const LAMPORTS_PER_SOL = 1_000_000_000n;

// The program hardcodes input-buffer offsets that assume a program id with a
// zero prefix, exactly what web3.js `PublicKey.unique()` used to provide.
const PROGRAM_ID = getAddressDecoder().decode(new Uint8Array([...new Array(31).fill(0), 1]));

describe('Create a system account', () => {
    const svm = new LiteSVM();
    let payer: KeyPairSigner;

    before(async () => {
        svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/create-account-asm-program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(2n * LAMPORTS_PER_SOL));
    });

    async function sendExpectSuccess(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Create the account via a cross program invocation', async () => {
        const newAccount = await generateKeyPairSigner();

        const ix = {
            programAddress: PROGRAM_ID,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: newAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: newAccount },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectSuccess(ix);

        const accountInfo = svm.getAccount(newAccount.address);
        assert.ok(accountInfo.exists, 'new account should exist');
        assert.ok(accountInfo.lamports > 0n, 'new account should have lamports');
        assert.equal(accountInfo.programAddress, SYSTEM_PROGRAM_ADDRESS);
    });

    it('Create the account via direct call to system program', async () => {
        const newAccount = await generateKeyPairSigner();

        const ix = getCreateAccountInstruction({
            payer,
            newAccount,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programAddress: SYSTEM_PROGRAM_ADDRESS,
        });

        await sendExpectSuccess(ix);

        const accountInfo = svm.getAccount(newAccount.address);
        assert.ok(accountInfo.exists, 'new account should exist');
        assert.equal(accountInfo.lamports, LAMPORTS_PER_SOL);
        assert.equal(accountInfo.programAddress, SYSTEM_PROGRAM_ADDRESS);
    });
});
