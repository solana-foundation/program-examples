import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createKeyPairSignerFromBytes,
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
import { LiteSVM, TransactionMetadata } from 'litesvm';

const PowerStatusSchema = { struct: { is_on: 'u8' } };
const SetPowerStatusSchema = { struct: { name: 'string' } };

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

async function programAddressFromKeypairFile(keypairPath: string): Promise<Address> {
    const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
    return (await createKeyPairSignerFromBytes(bytes)).address;
}

describe('Native CPI Example', () => {
    let svm: LiteSVM;
    let payer: KeyPairSigner;
    let handProgramId: Address;
    let leverProgramId: Address;
    let powerAccount: KeyPairSigner;

    before(async () => {
        svm = new LiteSVM();
        payer = await generateKeyPairSigner();

        handProgramId = await programAddressFromKeypairFile(
            './tests/fixtures/cross_program_invocatio_native_hand-keypair.json',
        );
        leverProgramId = await programAddressFromKeypairFile(
            './tests/fixtures/cross_program_invocatio_native_lever-keypair.json',
        );

        svm.airdrop(payer.address, lamports(10_000_000_000n));

        const native_hand = path.join('./tests/fixtures', 'cross_program_invocatio_native_hand.so');
        const native_lever = path.join('./tests/fixtures', 'cross_program_invocatio_native_lever.so');

        svm.addProgramFromFile(handProgramId, native_hand);
        svm.addProgramFromFile(leverProgramId, native_lever);

        powerAccount = await generateKeyPairSigner();
    });

    it('Initialize the lever!', async () => {
        const ix = {
            programAddress: leverProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: powerAccount },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(PowerStatusSchema, { is_on: 1 })),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const res = svm.sendTransaction(signedTx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });

    it('Pull the lever!', async () => {
        const ix = {
            programAddress: handProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE },
                { address: leverProgramId, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(SetPowerStatusSchema, { name: 'Chris' })),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const res = svm.sendTransaction(signedTx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });

    it('Pull it again!', async () => {
        const ix = {
            programAddress: handProgramId,
            accounts: [
                { address: powerAccount.address, role: AccountRole.WRITABLE },
                { address: leverProgramId, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(SetPowerStatusSchema, { name: 'Ashley' })),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const res = svm.sendTransaction(signedTx);
        if (!(res instanceof TransactionMetadata)) {
            throw new Error(`Transaction failed: ${JSON.stringify(res)}`);
        }
    });
});
