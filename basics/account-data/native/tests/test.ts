import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { start } from 'solana-bankrun';

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

describe('Account Data!', async () => {
    const addressInfoAccount = Keypair.generate();
    const PROGRAM_ID = PublicKey.unique();
    const context = await start([{ name: 'account_data_native_program', programId: PROGRAM_ID }], []);
    const client = context.banksClient;

    test('Create the address info account', async () => {
        const payer = context.payer;

        console.log(`Program Address      : ${PROGRAM_ID}`);
        console.log(`Payer Address      : ${payer.publicKey}`);
        console.log(`Address Info Acct  : ${addressInfoAccount.publicKey}`);

        const ix = new TransactionInstruction({
            keys: [
                {
                    pubkey: addressInfoAccount.publicKey,
                    isSigner: true,
                    isWritable: true,
                },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: borshSerialize(AddressInfoSchema, {
                name: 'Joe C',
                house_number: 136,
                street: 'Mile High Dr.',
                city: 'Solana Beach',
            }),
        });

        const blockhash = context.lastBlockhash;

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer, addressInfoAccount);
        await client.processTransaction(tx);
    });

    test("Read the new account's data", async () => {
        const accountInfo = await client.getAccount(addressInfoAccount.publicKey);

        const readAddressInfo = borsh.deserialize(AddressInfoSchema, Buffer.from(accountInfo.data)) as AddressInfo;
        console.log(`Name     : ${readAddressInfo.name}`);
        console.log(`House Num: ${readAddressInfo.house_number}`);
        console.log(`Street   : ${readAddressInfo.street}`);
        console.log(`City     : ${readAddressInfo.city}`);
    });
});
