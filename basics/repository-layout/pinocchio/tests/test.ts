import {
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
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { type CarnivalInstructionData, createCarnivalInstruction } from '../ts';

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

    async function sendCarnivalInstructions(instructionsList: CarnivalInstructionData[]) {
        const instructions = instructionsList.map(data => createCarnivalInstruction(payer, programId, data));

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
                ticketCount: 15,
                attraction: 'ride',
                attractionName: 'Scrambler',
            },
            {
                name: 'Mary',
                height: 52,
                ticketCount: 1,
                attraction: 'ride',
                attractionName: 'Ferris Wheel',
            },
            {
                name: 'Alice',
                height: 56,
                ticketCount: 15,
                attraction: 'ride',
                attractionName: 'Scrambler',
            },
            {
                name: 'Bob',
                height: 49,
                ticketCount: 6,
                attraction: 'ride',
                attractionName: 'Tilt-a-Whirl',
            },
        ]);
    });

    it('Play some games!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticketCount: 15,
                attraction: 'game',
                attractionName: 'I Got It!',
            },
            {
                name: 'Mary',
                height: 52,
                ticketCount: 1,
                attraction: 'game',
                attractionName: 'Ring Toss',
            },
            {
                name: 'Alice',
                height: 56,
                ticketCount: 15,
                attraction: 'game',
                attractionName: 'Ladder Climb',
            },
            {
                name: 'Bob',
                height: 49,
                ticketCount: 6,
                attraction: 'game',
                attractionName: 'Ring Toss',
            },
        ]);
    });

    it('Eat some food!', async () => {
        await sendCarnivalInstructions([
            {
                name: 'Jimmy',
                height: 36,
                ticketCount: 15,
                attraction: 'food',
                attractionName: 'Taco Shack',
            },
            {
                name: 'Mary',
                height: 52,
                ticketCount: 1,
                attraction: 'food',
                attractionName: "Larry's Pizza",
            },
            {
                name: 'Alice',
                height: 56,
                ticketCount: 15,
                attraction: 'food',
                attractionName: "Dough Boy's",
            },
            {
                name: 'Bob',
                height: 49,
                ticketCount: 6,
                attraction: 'food',
                attractionName: "Dough Boy's",
            },
        ]);
    });
});
