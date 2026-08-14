import {
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
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { type AddressInfo, addressInfoDecoder, createCreateAddressInfoInstruction } from '../ts';

describe('Account Data!', () => {
    const svm = new LiteSVM();
    const addressInfo: AddressInfo = {
        name: 'Joe C',
        houseNumber: 136,
        street: 'Mile High Dr.',
        city: 'Solana Beach',
    };
    let programId: Address;
    let payer: KeyPairSigner;
    let addressInfoAccount: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/account_data_native_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        addressInfoAccount = await generateKeyPairSigner();
    });

    it('Create the address info account', async () => {
        const ix = createCreateAddressInfoInstruction(addressInfoAccount, payer, programId, addressInfo);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    it("Read the new account's data", () => {
        const accountInfo = svm.getAccount(addressInfoAccount.address);
        assert(accountInfo.exists, 'address info account not found');

        assert.deepEqual(addressInfoDecoder.decode(accountInfo.data), addressInfo);
    });
});
