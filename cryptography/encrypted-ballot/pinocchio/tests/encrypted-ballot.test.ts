import { Buffer } from 'node:buffer';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from 'litesvm';

// Deterministic ristretto255 basepoint multiples summed with @noble/curves:
// BALLOT_A = [2G || 3G], BALLOT_B = [5G || 7G], SUM = [7G || 10G].
const BALLOT_A =
    '6a493210f7499cd17fecb510ae0cea23a110e8d5b901f8acadd3095c73a3b91994741f5d5d52755ece4f23f044ee27d5d1ea1e2bd196b462166b16152a9d0259';
const BALLOT_B =
    'e882b131016b52c1d3337080187cf768423efccbb517bb495ab812c4160ff44e44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d';
const SUM_AB =
    '44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d20706fd788b2720a1ed2a5dad4952b01f413bcf0e7564de8cdc816689e2db95f';

const IX_TALLY_ADD = 0;

const CIPHERTEXT = 64;
const COUNT_PREFIX = 2;

const ERR_INVALID_INPUT_LENGTH = 'InstructionErrorCustom { code: 0 }';
const ERR_INVALID_BALLOT_ACCOUNT = 'InstructionErrorCustom { code: 3 }';

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

const tallyData = (count: number, tally?: string) => {
    const data = new Uint8Array(COUNT_PREFIX + CIPHERTEXT);
    new DataView(data.buffer).setUint16(0, count, true);
    if (tally) data.set(hex(tally), COUNT_PREFIX);
    return data;
};

describe('encrypted-ballot', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/encrypted_ballot_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function tallyAccount(owner: Address, count: number, tally?: string) {
        const address = (await generateKeyPairSigner()).address;
        const data = tallyData(count, tally);
        svm.setAccount({
            address,
            data,
            executable: false,
            lamports: lamports(1_000_000_000n),
            programAddress: owner,
            space: BigInt(data.length),
        });
        return address;
    }

    function tallyAccountData(tally: Address) {
        const account = svm.getAccount(tally);
        assert(account?.exists, 'expected the tally account to exist');
        return account.data;
    }

    async function send(ballot: Uint8Array, tally: Address) {
        const data = new Uint8Array([IX_TALLY_ADD, ...ballot]);
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstruction(
                    { programAddress: programId, accounts: [{ address: tally, role: AccountRole.WRITABLE }], data },
                    m,
                ),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        svm.expireBlockhash();
        return result;
    }

    it('the first ballot becomes the tally verbatim', async () => {
        const tally = await tallyAccount(programId, 0);
        const result = await send(hex(BALLOT_A), tally);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        assert.deepEqual(tallyAccountData(tally), tallyData(1, BALLOT_A));
    });

    it('the second ballot folds into the running encrypted tally', async () => {
        const tally = await tallyAccount(programId, 1, BALLOT_A);
        const result = await send(hex(BALLOT_B), tally);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        assert.deepEqual(tallyAccountData(tally), tallyData(2, SUM_AB));
    });

    it('rejects a ballot that is not exactly one ciphertext', async () => {
        const tally = await tallyAccount(programId, 0);
        const result = await send(new Uint8Array(3), tally);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_INVALID_INPUT_LENGTH);
    });

    it('rejects an account not owned by the program', async () => {
        const foreignOwner = (await generateKeyPairSigner()).address;
        const tally = await tallyAccount(foreignOwner, 0);
        const result = await send(hex(BALLOT_A), tally);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_INVALID_BALLOT_ACCOUNT);
    });
});
