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
import { getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
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
    let feePayer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/realloc_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        testAccount = await generateKeyPairSigner();

        feePayer = await generateKeyPairSigner();
        svm.airdrop(feePayer.address, lamports(1_000_000_000n));
    });

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(feePayer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
        return result;
    }

    function getTestAccountData(): Uint8Array {
        const account = svm.getAccount(testAccount.address);
        assert(account.exists, 'test account not found');
        return new Uint8Array(account.data);
    }

    function createAccountInstruction(target: KeyPairSigner) {
        return {
            programAddress: programId,
            accounts: [
                { address: target.address, role: AccountRole.WRITABLE_SIGNER, signer: target },
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
    }

    function createReallocateInstruction(target: Address) {
        return {
            programAddress: programId,
            accounts: [
                { address: target, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: reallocWithoutZeroInitEncoder.encode({ discriminator: 1, state: 'Illinois', zip: 12345 }),
        };
    }

    it('Create the account with data', async () => {
        await sendInstruction(createAccountInstruction(testAccount));

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);

        const addressInfo = addressInfoDecoder.decode(data);
        assert.strictEqual(addressInfo.name, 'Jacob');
        assert.strictEqual(addressInfo.houseNumber, 123);
        assert.strictEqual(addressInfo.street, 'Main St.');
        assert.strictEqual(addressInfo.city, 'Chicago');
    });

    it('Reallocate WITHOUT zero init', async () => {
        const targetBefore = svm.getAccount(testAccount.address);
        assert(targetBefore.exists);
        const payerBefore = svm.getAccount(payer.address);
        assert(payerBefore.exists);
        const result = await sendInstruction(createReallocateInstruction(testAccount.address));

        const rentMinimum = svm.minimumBalanceForRentExemption(BigInt(enhancedAddressInfoDecoder.fixedSize));
        const rentShortfall = rentMinimum - targetBefore.lamports;
        assert.equal(svm.getBalance(testAccount.address), rentMinimum);
        assert.equal(svm.getBalance(payer.address), payerBefore.lamports - rentShortfall);
        assert.lengthOf(result.innerInstructions().flat(), 1);

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

    async function prepareFundedReallocation(excess: bigint) {
        const target = await generateKeyPairSigner();
        await sendInstruction(createAccountInstruction(target));

        const createdAccount = svm.getAccount(target.address);
        assert(createdAccount.exists);
        const newSize = enhancedAddressInfoDecoder.fixedSize;
        const fundedBalance = svm.minimumBalanceForRentExemption(BigInt(newSize)) + excess;
        await sendInstruction(
            getTransferSolInstruction({
                source: payer,
                destination: target.address,
                amount: lamports(fundedBalance - createdAccount.lamports),
            }),
        );

        const reallocIx = createReallocateInstruction(target.address);
        return { target, reallocIx, newSize, fundedBalance };
    }

    for (const excess of [0n, 1_000_000n]) {
        it(`Reallocates an account funded ${excess} lamports above its new rent minimum`, async () => {
            const { target, reallocIx, newSize, fundedBalance } = await prepareFundedReallocation(excess);
            const payerBefore = svm.getAccount(payer.address);
            assert(payerBefore.exists);
            const result = await sendInstruction(reallocIx);

            const account = svm.getAccount(target.address);
            assert(account.exists);
            assert.equal(account.data.length, newSize);
            assert.equal(account.lamports, fundedBalance);
            assert.equal(svm.getBalance(payer.address), payerBefore.lamports);
            assert.deepEqual(enhancedAddressInfoDecoder.decode(account.data), {
                name: 'Jacob',
                houseNumber: 123,
                street: 'Main St.',
                city: 'Chicago',
                state: 'Illinois',
                zip: 12345,
            });
            assert.isEmpty(result.innerInstructions().flat());
        });
    }

    it('Rejects an unsigned payer when rent is already funded', async () => {
        const { target, reallocIx } = await prepareFundedReallocation(0n);
        const targetBefore = svm.getAccount(target.address);
        assert(targetBefore.exists);
        const unsignedPayer = (await generateKeyPairSigner()).address;
        const unsignedIx: Instruction = {
            ...reallocIx,
            accounts: reallocIx.accounts.map((account, index) =>
                index === 1 ? { address: unsignedPayer, role: AccountRole.WRITABLE } : account,
            ),
        };
        const message = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(feePayer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(unsignedIx, m),
        );
        const failedResult = svm.sendTransaction(await signTransactionMessageWithSigners(message));
        assert(failedResult instanceof FailedTransactionMetadata, 'expected the unsigned payer to be rejected');
        assert.include(failedResult.err().toString(), 'MissingRequiredSignature');

        assert.deepEqual(svm.getAccount(target.address), targetBefore);
    });
});
