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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const AddressInfoSchema = {
    struct: {
        name: 'string',
        house_number: 'u8',
        street: 'string',
        city: 'string',
    },
};

type AddressInfo = {
    name: string;
    house_number: number;
    street: string;
    city: string;
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

describe('Account Data!', () => {
    const svm = new LiteSVM();
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
        console.log(`Program Address      : ${programId}`);
        console.log(`Payer Address      : ${payer.address}`);
        console.log(`Address Info Acct  : ${addressInfoAccount.address}`);

        const ix = {
            programAddress: programId,
            accounts: [
                {
                    address: addressInfoAccount.address,
                    role: AccountRole.WRITABLE_SIGNER,
                    signer: addressInfoAccount,
                },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                borshSerialize(AddressInfoSchema, {
                    name: 'Joe C',
                    house_number: 136,
                    street: 'Mile High Dr.',
                    city: 'Solana Beach',
                }),
            ),
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
    });

    it("Read the new account's data", () => {
        const accountInfo = svm.getAccount(addressInfoAccount.address);
        assert(accountInfo.exists, 'address info account not found');

        const readAddressInfo = borsh.deserialize(AddressInfoSchema, Buffer.from(accountInfo.data)) as AddressInfo;
        console.log(`Name     : ${readAddressInfo.name}`);
        console.log(`House Num: ${readAddressInfo.house_number}`);
        console.log(`Street   : ${readAddressInfo.street}`);
        console.log(`City     : ${readAddressInfo.city}`);
    });
});
