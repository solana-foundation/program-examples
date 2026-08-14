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
import { ReallocInstruction } from '.';

// Instruction data layout, matching the program's `ReallocInstruction::Create(AddressInfo)` variant.
export const createEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['house_number', getU8Encoder()],
    ['street', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['city', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
]);

export function createCreateInstruction(
    target: TransactionSigner,
    payer: TransactionSigner,
    programId: Address,
    name: string,
    house_number: number,
    street: string,
    city: string,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: target.address, role: AccountRole.WRITABLE_SIGNER, signer: target },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createEncoder.encode({
            instruction: ReallocInstruction.Create,
            name,
            house_number,
            street,
            city,
        }),
    };
}
