import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('hello-solana', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        // load program in litesvm
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/hello_solana_program_pinocchio.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    it('Say hello!', async () => {
        // We set up our instruction first.
        const ix = {
            programAddress: programId,
            accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
            data: new Uint8Array(0), // No data
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        // Now we process the transaction
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const programIdBytes = getAddressEncoder().encode(programId);
        const logs = result.logs();
        assert(logs[0].startsWith(`Program ${programId}`));
        assert(logs[1] === 'Program log: Hello, Solana!');
        assert(logs[2] === `Program log: [${Array.from(programIdBytes).join(', ')}]`);
        assert(logs[3].startsWith(`Program ${programId} consumed`));
        assert(logs[4] === `Program ${programId} success`);
        assert(logs.length === 5);
    });
});
