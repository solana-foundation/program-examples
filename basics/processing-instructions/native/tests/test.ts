import { Buffer } from 'node:buffer';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('custom-instruction-data', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/processing_instructions_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    const InstructionDataSchema = {
        struct: {
            name: 'string',
            height: 'u32',
        },
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    it('Go to the park!', async () => {
        const jimmy = borshSerialize(InstructionDataSchema, {
            name: 'Jimmy',
            height: 3,
        });
        const mary = borshSerialize(InstructionDataSchema, {
            name: 'Mary',
            height: 10,
        });

        const ix1 = {
            programAddress: programId,
            accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
            data: new Uint8Array(jimmy),
        };

        const ix2 = {
            ...ix1,
            data: new Uint8Array(mary),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions([ix1, ix2], m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
