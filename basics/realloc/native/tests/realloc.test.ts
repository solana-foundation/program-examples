import {
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

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/realloc_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        testAccount = await generateKeyPairSigner();
    });

    async function sendTransaction(ix: Instruction) {
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

    it('Create the account with data', async () => {
        console.log(`${testAccount.address}`);
        const ix = createCreateInstruction(testAccount, payer, programId, 'Jacob', 123, 'Main St.', 'Chicago');

        await sendTransaction(ix);

        printAddressInfo(testAccount.address);
    });

    it('Reallocate WITHOUT zero init', async () => {
        const ix = createReallocateWithoutZeroInitInstruction(testAccount.address, payer, programId, 'Illinois', 12345);

        await sendTransaction(ix);

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
