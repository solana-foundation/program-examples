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

describe('Carnival (Pinocchio)', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/repository_layout_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    const CarnivalInstructionSchema = {
        struct: {
            name: 'string',
            height: 'u32',
            ticket_count: 'u32',
            attraction: 'string',
            attraction_name: 'string',
        },
    };

    type CarnivalInstruction = {
        name: string;
        height: number;
        ticket_count: number;
        attraction: string;
        attraction_name: string;
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    async function sendCarnivalInstructions(instructionsList: CarnivalInstruction[]) {
        const instructions = instructionsList.map(ix => ({
            programAddress: programId,
            accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
            data: new Uint8Array(borshSerialize(CarnivalInstructionSchema, ix)),
        }));

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Go on some rides!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'ride',
                attraction_name: 'Scrambler',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'ride',
                attraction_name: 'Ferris Wheel',
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'ride',
                attraction_name: 'Scrambler',
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'ride',
                attraction_name: 'Tilt-a-Whirl',
            },
        ]);
    });

    it('Play some games!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'game',
                attraction_name: 'I Got It!',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'game',
                attraction_name: 'Ring Toss',
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'game',
                attraction_name: 'Ladder Climb',
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'game',
                attraction_name: 'Ring Toss',
            },
        ]);
    });

    it('Eat some food!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticket_count: 15,
                attraction: 'food',
                attraction_name: 'Taco Shack',
            },
            {
                name: 'Mary',
                height: 52,
                ticket_count: 1,
                attraction: 'food',
                attraction_name: "Larry's Pizza",
            },
            {
                name: 'Alice',
                height: 56,
                ticket_count: 15,
                attraction: 'food',
                attraction_name: "Dough Boy's",
            },
            {
                name: 'Bob',
                height: 49,
                ticket_count: 6,
                attraction: 'food',
                attraction_name: "Dough Boy's",
            },
        ]);
    });
});
