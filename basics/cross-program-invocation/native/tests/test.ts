import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    type Address,
    appendTransactionMessageInstruction,
    createKeyPairSignerFromBytes,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { LiteSVM, TransactionMetadata } from 'litesvm';
import { createInitializeInstruction, createPullLeverInstruction } from '../ts';

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

    async function sendTransaction(ix: Instruction) {
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
    }

    it('Initialize the lever!', async () => {
        await sendTransaction(createInitializeInstruction(powerAccount, payer, leverProgramId, true));
    });

    it('Pull the lever!', async () => {
        await sendTransaction(createPullLeverInstruction(powerAccount.address, leverProgramId, handProgramId, 'Chris'));
    });

    it('Pull it again!', async () => {
        await sendTransaction(
            createPullLeverInstruction(powerAccount.address, leverProgramId, handProgramId, 'Ashley'),
        );
    });
});
