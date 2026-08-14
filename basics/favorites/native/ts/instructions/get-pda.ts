import { AccountRole, type Address, getStructEncoder, getU8Encoder, type TransactionSigner } from '@solana/kit';
import { FavoritesInstruction } from '.';

// Instruction data layout, matching the program's `FavoritesInstruction::GetPda` variant.
export const getPdaEncoder = getStructEncoder([['instruction', getU8Encoder()]]);

export function createGetPdaInstruction(user: TransactionSigner, favoritesPda: Address, programId: Address) {
    return {
        programAddress: programId,
        accounts: [
            { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
            { address: favoritesPda, role: AccountRole.READONLY },
        ],
        data: getPdaEncoder.encode({ instruction: FavoritesInstruction.GetPda }),
    };
}
