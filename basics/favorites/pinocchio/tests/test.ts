import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    fixDecoderSize,
    fixEncoderSize,
    generateKeyPairSigner,
    getAddressEncoder,
    getArrayDecoder,
    getArrayEncoder,
    getProgramDerivedAddress,
    getStructDecoder,
    getStructEncoder,
    getU8Encoder,
    getU64Decoder,
    getU64Encoder,
    getUtf8Decoder,
    getUtf8Encoder,
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

const createFavoritesEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['bump', getU8Encoder()],
    ['number', getU64Encoder()],
    ['color', fixEncoderSize(getUtf8Encoder(), 8)],
    ['hobbies', getArrayEncoder(fixEncoderSize(getUtf8Encoder(), 16), { size: 4 })],
]);

const favoritesDecoder = getStructDecoder([
    ['number', getU64Decoder()],
    ['color', fixDecoderSize(getUtf8Decoder(), 8)],
    ['hobbies', getArrayDecoder(fixDecoderSize(getUtf8Decoder(), 16), { size: 4 })],
]);

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
        const ix = {
            programAddress: programId,
            accounts: [
                { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
                { address: favoritesPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: createFavoritesEncoder.encode({
                discriminator: CREATE_PDA,
                bump: favoritesBump,
                ...favorites,
            }),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(favoritesPda);
        assert(account.exists);
        assert.equal(account.programAddress, programId);
        const stored = favoritesDecoder.decode(account.data);
        assert.equal(stored.number, favorites.number);
        assert.equal(stored.color, favorites.color);
        assert.deepEqual(stored.hobbies, favorites.hobbies);
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
