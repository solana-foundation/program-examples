import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
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
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/favorites_pinocchio.so');

    const user = Keypair.generate();
    svm.airdrop(user.publicKey, BigInt(LAMPORTS_PER_SOL));

    const [favoritesPda, favoritesBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('favorite'), user.publicKey.toBuffer()],
        PROGRAM_ID,
    );

    const favorites = {
        number: 42n,
        color: 'blue',
        hobbies: ['coding', 'reading', 'travelling', 'shitposting'],
    };

    it('Create the favorites PDA', () => {
        const number = Buffer.alloc(8);
        number.writeBigUInt64LE(favorites.number);
        const data = Buffer.concat([
            Buffer.from([CREATE_PDA, favoritesBump]),
            number,
            fixedBytes(favorites.color, 8),
            ...favorites.hobbies.map(hobby => fixedBytes(hobby, 16)),
        ]);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: user.publicKey, isSigner: true, isWritable: true },
                { pubkey: favoritesPda, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(user);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(favoritesPda);
        assert(account !== null);
        assert.equal(account.owner.toBase58(), PROGRAM_ID.toBase58());
        const stored = Buffer.from(account.data);
        assert.equal(stored.readBigUInt64LE(0), favorites.number);
        assert.equal(stored.subarray(8, 8 + favorites.color.length).toString('utf8'), favorites.color);
        favorites.hobbies.forEach((hobby, index) => {
            const offset = 16 + index * 16;
            assert.equal(stored.subarray(offset, offset + hobby.length).toString('utf8'), hobby);
        });
    });

    it('Read the favorites PDA', () => {
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: user.publicKey, isSigner: true, isWritable: true },
                { pubkey: favoritesPda, isSigner: false, isWritable: true },
            ],
            programId: PROGRAM_ID,
            data: Buffer.from([GET_PDA, favoritesBump]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(user);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
