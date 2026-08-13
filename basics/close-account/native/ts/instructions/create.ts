import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU32Encoder,
    getUtf8Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::CreateUser(User)` variant.
export const createUserEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
]);

export function createCreateUserInstruction(
    target: Address,
    payer: TransactionSigner,
    programId: Address,
    name: string,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: target, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createUserEncoder.encode({ instruction: MyInstruction.CreateUser, name }),
    };
}
