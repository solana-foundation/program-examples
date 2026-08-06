import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    fixEncoderSize,
    generateKeyPairSigner,
    getStructEncoder,
    getU32Encoder,
    getUtf8Encoder,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const instructionDataEncoder = getStructEncoder([
    ['name', fixEncoderSize(getUtf8Encoder(), 8)],
    ['height', getU32Encoder()],
]);

describe('custom-instruction-data', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/processing_instructions_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function goToPark(name: string, height: number): Promise<string[]> {
        const ix = {
            programAddress: programId,
            accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
            data: instructionDataEncoder.encode({ name, height }),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
        return result.logs();
    }

    it('Jimmy (height 3) is NOT tall enough to ride', async () => {
        const logs = await goToPark('Jimmy', 3);
        assert(logs.some(log => log.includes('Welcome to the park, Jimmy')));
        assert(logs.some(log => log.includes('You are NOT tall enough to ride this ride')));
    });

    it('Mary (height 10) is tall enough to ride', async () => {
        const logs = await goToPark('Mary', 10);
        assert(logs.some(log => log.includes('Welcome to the park, Mary')));
        assert(logs.some(log => log.includes('You are tall enough to ride this ride')));
        assert(!logs.some(log => log.includes('NOT tall enough')));
    });
});
