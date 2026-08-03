import { Buffer } from 'node:buffer';
import {
    AccountRole,
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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { assert, expect } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { describe, test } from 'mocha';

const MyInstruction = {
    CreateFav: 0,
    GetFav: 1,
} as const;

const CreateFavSchema = {
    struct: {
        instruction: 'u8',
        number: 'u64',
        color: 'string',
        hobbies: { array: { type: 'string' } },
    },
};

const FavoritesDataSchema = {
    struct: {
        number: 'u64',
        color: 'string',
        hobbies: { array: { type: 'string' } },
    },
};

const GetFavSchema = {
    struct: {
        instruction: 'u8',
    },
};

type FavoritesData = {
    number: number | bigint;
    color: string;
    hobbies: string[];
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

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

    test('Set the favorite pda and cross-check the updated data', async () => {
        const [favoritesPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['favorite', addressEncoder.encode(payer.address)],
        });
        const favData = {
            instruction: MyInstruction.CreateFav,
            number: 42,
            color: 'blue',
            hobbies: ['coding', 'reading', 'traveling'],
        };

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: favoritesPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(CreateFavSchema, favData)),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(favoritesPda);
        assert(account.exists, 'favorites account not found');
        const data = Buffer.from(account.data);

        const favoritesData = borsh.deserialize(FavoritesDataSchema, data) as FavoritesData;

        console.log('Deserialized data:', favoritesData);

        expect(Number(favoritesData.number)).to.equal(favData.number);
        expect(favoritesData.color).to.equal(favData.color);
        expect(favoritesData.hobbies).to.deep.equal(favData.hobbies);
    });

    test("Check if the test fails if the pda seeds aren't same", async () => {
        // Derive a PDA using WRONG seeds so the program's on-chain seed check rejects it
        const [wrongPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['wrong_seed', addressEncoder.encode(payer.address)],
        });
        const favData = {
            instruction: MyInstruction.CreateFav,
            number: 42,
            color: 'blue',
            hobbies: ['coding', 'reading', 'traveling'],
        };

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: wrongPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(CreateFavSchema, favData)),
        };

        const result = await sendInstruction(ix);
        assert(result instanceof FailedTransactionMetadata, 'Expected transaction to fail with wrong PDA seeds');
    });

    test('Get the favorite pda and cross-check the data', async () => {
        // Creating a new account with payer's pubkey
        const [favoritesPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['favorite', addressEncoder.encode(payer.address)],
        });
        const favData = {
            instruction: MyInstruction.CreateFav,
            number: 42,
            color: 'hazel',
            hobbies: ['singing', 'dancing', 'skydiving'],
        };

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: favoritesPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(CreateFavSchema, favData)),
        };

        const result1 = await sendInstruction(ix);
        assert(!(result1 instanceof FailedTransactionMetadata), `transaction failed: ${result1.toString()}`);

        // Getting the user's data through the get_pda instruction
        const ix2 = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: favoritesPda, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(borshSerialize(GetFavSchema, { instruction: MyInstruction.GetFav })),
        };

        const result = await sendInstruction(ix2);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
