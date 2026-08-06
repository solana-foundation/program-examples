import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    fixDecoderSize,
    fixEncoderSize,
    generateKeyPairSigner,
    getStructDecoder,
    getStructEncoder,
    getU8Decoder,
    getU8Encoder,
    getU32Decoder,
    getU32Encoder,
    getUtf8Decoder,
    getUtf8Encoder,
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

const fixedStringEncoder = fixEncoderSize(getUtf8Encoder(), 8);
const fixedStringDecoder = fixDecoderSize(getUtf8Decoder(), 8);

const createEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['name', fixedStringEncoder],
    ['houseNumber', getU8Encoder()],
    ['street', fixedStringEncoder],
    ['city', fixedStringEncoder],
]);

const reallocWithoutZeroInitEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['state', fixedStringEncoder],
    ['zip', getU32Encoder()],
]);

const reallocWithZeroInitEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['name', fixedStringEncoder],
    ['position', fixedStringEncoder],
    ['company', fixedStringEncoder],
    ['yearsEmployed', getU8Encoder()],
]);

const addressInfoDecoder = getStructDecoder([
    ['name', fixedStringDecoder],
    ['houseNumber', getU8Decoder()],
    ['street', fixedStringDecoder],
    ['city', fixedStringDecoder],
]);

const enhancedAddressInfoDecoder = getStructDecoder([
    ['name', fixedStringDecoder],
    ['houseNumber', getU8Decoder()],
    ['street', fixedStringDecoder],
    ['city', fixedStringDecoder],
    ['state', fixedStringDecoder],
    ['zip', getU32Decoder()],
]);

const workInfoDecoder = getStructDecoder([
    ['name', fixedStringDecoder],
    ['position', fixedStringDecoder],
    ['company', fixedStringDecoder],
    ['yearsEmployed', getU8Decoder()],
]);

describe('Realloc!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testAccount: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/realloc_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        testAccount = await generateKeyPairSigner();
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

    function getTestAccountData(): Uint8Array {
        const account = svm.getAccount(testAccount.address);
        assert(account.exists, 'test account not found');
        return new Uint8Array(account.data);
    }

    it('Create the account with data', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: testAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: testAccount },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: createEncoder.encode({
                discriminator: 0,
                name: 'Jacob',
                houseNumber: 123,
                street: 'Main St.',
                city: 'Chicago',
            }),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);

        const addressInfo = addressInfoDecoder.decode(data);
        assert.strictEqual(addressInfo.name, 'Jacob');
        assert.strictEqual(addressInfo.houseNumber, 123);
        assert.strictEqual(addressInfo.street, 'Main St.');
        assert.strictEqual(addressInfo.city, 'Chicago');
    });

    it('Reallocate WITHOUT zero init', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: testAccount.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: reallocWithoutZeroInitEncoder.encode({ discriminator: 1, state: 'Illinois', zip: 12345 }),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 37);

        const addressInfo = enhancedAddressInfoDecoder.decode(data);
        assert.strictEqual(addressInfo.name, 'Jacob');
        assert.strictEqual(addressInfo.state, 'Illinois');
        assert.strictEqual(addressInfo.zip, 12345);
    });

    it('Reallocate WITH zero init', async () => {
        const ix = {
            programAddress: programId,
            accounts: [{ address: testAccount.address, role: AccountRole.WRITABLE }],
            data: reallocWithZeroInitEncoder.encode({
                discriminator: 2,
                name: 'Perelyn',
                position: 'Eng',
                company: 'Anza',
                yearsEmployed: 2,
            }),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);

        const workInfo = workInfoDecoder.decode(data);
        assert.strictEqual(workInfo.name, 'Perelyn');
        assert.strictEqual(workInfo.position, 'Eng');
        assert.strictEqual(workInfo.company, 'Anza');
        assert.strictEqual(workInfo.yearsEmployed, 2);
    });
});
