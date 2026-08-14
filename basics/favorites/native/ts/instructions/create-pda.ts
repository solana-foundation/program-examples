import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getArrayEncoder,
    getStructEncoder,
    getU8Encoder,
    getU32Encoder,
    getU64Encoder,
    getUtf8Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FavoritesInstruction } from '.';
import type { Favorites } from '../state';

// Instruction data layout, matching the program's `FavoritesInstruction::CreatePda(Favorites)` variant.
export const createPdaEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['number', getU64Encoder()],
    ['color', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['hobbies', getArrayEncoder(addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder()), { size: getU32Encoder() })],
]);

export function createCreatePdaInstruction(
    user: TransactionSigner,
    favoritesPda: Address,
    programId: Address,
    favorites: Favorites,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
            { address: favoritesPda, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createPdaEncoder.encode({ instruction: FavoritesInstruction.CreatePda, ...favorites }),
    };
}
