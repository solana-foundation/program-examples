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
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const CREATE_PDA = 1;
const GET_PDA = 2;

function fixedBytes(text: string, length: number): Buffer {
    const buffer = Buffer.alloc(length);
    buffer.write(text, 'utf8');
    return buffer;
}

describe('Favorites Solana Pinocchio', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let user: KeyPairSigner;
    let favoritesPda: Address;
    let favoritesBump: number;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/favorites_pinocchio.so');

        user = await generateKeyPairSigner();
        svm.airdrop(user.address, lamports(1_000_000_000n));

        [favoritesPda, favoritesBump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['favorite', getAddressEncoder().encode(user.address)],
        });
    });

    const favorites = {
        number: 42n,
        color: 'blue',
        hobbies: ['coding', 'reading', 'travelling', 'shitposting'],
    };

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(user, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        return svm.sendTransaction(signedTx);
    }

    it('Create the favorites PDA', async () => {
        const number = Buffer.alloc(8);
        number.writeBigUInt64LE(favorites.number);
        const data = Buffer.concat([
            Buffer.from([CREATE_PDA, favoritesBump]),
            number,
            fixedBytes(favorites.color, 8),
            ...favorites.hobbies.map(hobby => fixedBytes(hobby, 16)),
        ]);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
                { address: favoritesPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(data),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(favoritesPda);
        assert(account.exists);
        assert.equal(account.programAddress, programId);
        const stored = Buffer.from(account.data);
        assert.equal(stored.readBigUInt64LE(0), favorites.number);
        assert.equal(stored.subarray(8, 8 + favorites.color.length).toString('utf8'), favorites.color);
        favorites.hobbies.forEach((hobby, index) => {
            const offset = 16 + index * 16;
            assert.equal(stored.subarray(offset, offset + hobby.length).toString('utf8'), hobby);
        });
    });

    it('Read the favorites PDA', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
                { address: favoritesPda, role: AccountRole.WRITABLE },
            ],
            data: new Uint8Array([GET_PDA, favoritesBump]),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
