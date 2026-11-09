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
import { getTransferSolInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import {
    addressInfoDecoder,
    createCreateInstruction,
    createReallocateWithoutZeroInitInstruction,
    createReallocateZeroInitInstruction,
    enhancedAddressInfoDecoder,
    workInfoDecoder,
} from '../ts';

describe('Realloc!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testAccount: KeyPairSigner;
    let feePayer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/realloc_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        testAccount = await generateKeyPairSigner();

        feePayer = await generateKeyPairSigner();
        svm.airdrop(feePayer.address, lamports(1_000_000_000n));
    });

    async function sendTransaction(ix: Instruction) {
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

    it('Create the account with data', async () => {
        console.log(`${testAccount.address}`);
        const ix = createCreateInstruction(testAccount, payer, programId, 'Jacob', 123, 'Main St.', 'Chicago');

        await sendTransaction(ix);

        printAddressInfo(testAccount.address);
    });

    it('Reallocate WITHOUT zero init', async () => {
        const ix = createReallocateWithoutZeroInitInstruction(testAccount.address, payer, programId, 'Illinois', 12345);

        const targetBefore = svm.getAccount(testAccount.address);
        assert(targetBefore.exists);
        const payerBefore = svm.getAccount(payer.address);
        assert(payerBefore.exists);
        const result = await sendTransaction(ix);

        const account = svm.getAccount(testAccount.address);
        assert(account.exists);
        assert.equal(account.lamports, svm.minimumBalanceForRentExemption(BigInt(account.data.length)));
        assert.equal(svm.getBalance(payer.address), payerBefore.lamports - (account.lamports - targetBefore.lamports));
        assert.lengthOf(result.innerInstructions().flat(), 1);
        assert.deepEqual(enhancedAddressInfoDecoder.decode(account.data), {
            name: 'Jacob',
            house_number: 123,
            street: 'Main St.',
            city: 'Chicago',
            state: 'Illinois',
            zip: 12345,
        });

        printEnhancedAddressInfo(testAccount.address);
    });

    it('Reallocate WITH zero init', async () => {
        const ix = createReallocateZeroInitInstruction(
            testAccount.address,
            payer.address,
            programId,
            'Pete',
            'Engineer',
            'Solana Labs',
            2,
        );

        await sendTransaction(ix);

        printWorkInfo(testAccount.address);
    });

    async function prepareFundedReallocation(excess: bigint) {
        const target = await generateKeyPairSigner();
        await sendTransaction(createCreateInstruction(target, payer, programId, 'Jacob', 123, 'Main St.', 'Chicago'));

        const createdAccount = svm.getAccount(target.address);
        assert(createdAccount.exists);
        const reallocIx = createReallocateWithoutZeroInitInstruction(
            target.address,
            payer,
            programId,
            'Illinois',
            12345,
        );
        // the payload appends the new fields, so its first byte is the instruction tag
        const newSize = createdAccount.data.length + reallocIx.data.length - 1;
        const fundedBalance = svm.minimumBalanceForRentExemption(BigInt(newSize)) + excess;
        await sendTransaction(
            getTransferSolInstruction({
                source: payer,
                destination: target.address,
                amount: lamports(fundedBalance - createdAccount.lamports),
            }),
        );

        return { target, reallocIx, newSize, fundedBalance };
    }

    for (const excess of [0n, 1_000_000n]) {
        it(`Reallocates an account funded ${excess} lamports above its new rent minimum`, async () => {
            const { target, reallocIx, newSize, fundedBalance } = await prepareFundedReallocation(excess);
            const payerBefore = svm.getAccount(payer.address);
            assert(payerBefore.exists);
            const result = await sendTransaction(reallocIx);

            const account = svm.getAccount(target.address);
            assert(account.exists);
            assert.equal(account.data.length, newSize);
            assert.equal(account.lamports, fundedBalance);
            assert.equal(svm.getBalance(payer.address), payerBefore.lamports);
            assert.deepEqual(enhancedAddressInfoDecoder.decode(account.data), {
                name: 'Jacob',
                house_number: 123,
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

    function printAddressInfo(address: Address): void {
        const account = svm.getAccount(address);
        if (account.exists) {
            const addressInfo = addressInfoDecoder.decode(account.data);
            console.log('Address info:');
            console.log(`   Name:       ${addressInfo.name}`);
            console.log(`   House Num:  ${addressInfo.house_number}`);
            console.log(`   Street:     ${addressInfo.street}`);
            console.log(`   City:       ${addressInfo.city}`);
        }
    }

    function printEnhancedAddressInfo(address: Address): void {
        const account = svm.getAccount(address);
        if (account.exists) {
            const enhancedAddressInfo = enhancedAddressInfoDecoder.decode(account.data);
            console.log('Enhanced Address info:');
            console.log(`   Name:       ${enhancedAddressInfo.name}`);
            console.log(`   House Num:  ${enhancedAddressInfo.house_number}`);
            console.log(`   Street:     ${enhancedAddressInfo.street}`);
            console.log(`   City:       ${enhancedAddressInfo.city}`);
            console.log(`   State:      ${enhancedAddressInfo.state}`);
            console.log(`   Zip:        ${enhancedAddressInfo.zip}`);
        }
    }

    function printWorkInfo(address: Address): void {
        const account = svm.getAccount(address);
        if (account.exists) {
            const workInfo = workInfoDecoder.decode(account.data);
            console.log('Work info:');
            console.log(`   Name:       ${workInfo.name}`);
            console.log(`   Position:   ${workInfo.position}`);
            console.log(`   Company:    ${workInfo.company}`);
            console.log(`   Years:      ${workInfo.years_employed}`);
        }
    }
});
