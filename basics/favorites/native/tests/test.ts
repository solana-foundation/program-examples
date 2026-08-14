import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert, expect } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { describe, test } from 'mocha';
import { createCreatePdaInstruction, createGetPdaInstruction, type Favorites, favoritesDecoder } from '../ts';

const addressEncoder = getAddressEncoder();

describe('Favorites Solana Native', () => {
    // Randomly generate the program address and load the program to litesvm
    let programId: Address;

    let svm: LiteSVM;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
    });

    beforeEach(async () => {
        svm = new LiteSVM();
        svm.addProgramFromFile(programId, 'tests/fixtures/favorites_native.so');
        // Generate a payer keypair and fund it with enough lamports to sign transactions
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        return svm.sendTransaction(signedTx);
    }

    function deriveFavoritesPda(seed: string) {
        return getProgramDerivedAddress({
            programAddress: programId,
            seeds: [seed, addressEncoder.encode(payer.address)],
        });
    }

    test('Set the favorite pda and cross-check the updated data', async () => {
        const [favoritesPda] = await deriveFavoritesPda('favorite');
        const favData: Favorites = {
            number: 42n,
            color: 'blue',
            hobbies: ['coding', 'reading', 'traveling'],
        };

        const result = await sendInstruction(createCreatePdaInstruction(payer, favoritesPda, programId, favData));
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(favoritesPda);
        assert(account.exists, 'favorites account not found');

        const favoritesData = favoritesDecoder.decode(account.data);
        expect(favoritesData.number).to.equal(favData.number);
        expect(favoritesData.color).to.equal(favData.color);
        expect(favoritesData.hobbies).to.deep.equal(favData.hobbies);
    });

    test("Check if the test fails if the pda seeds aren't same", async () => {
        // Derive a PDA using WRONG seeds so the program's on-chain seed check rejects it
        const [wrongPda] = await deriveFavoritesPda('wrong_seed');
        const favData: Favorites = {
            number: 42n,
            color: 'blue',
            hobbies: ['coding', 'reading', 'traveling'],
        };

        const result = await sendInstruction(createCreatePdaInstruction(payer, wrongPda, programId, favData));
        assert(result instanceof FailedTransactionMetadata, 'Expected transaction to fail with wrong PDA seeds');
    });

    test('Get the favorite pda and cross-check the data', async () => {
        const [favoritesPda] = await deriveFavoritesPda('favorite');
        const favData: Favorites = {
            number: 42n,
            color: 'hazel',
            hobbies: ['singing', 'dancing', 'skydiving'],
        };

        const result1 = await sendInstruction(createCreatePdaInstruction(payer, favoritesPda, programId, favData));
        assert(!(result1 instanceof FailedTransactionMetadata), `transaction failed: ${result1.toString()}`);

        // Getting the user's data through the get_pda instruction
        const result = await sendInstruction(createGetPdaInstruction(payer, favoritesPda, programId));
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
