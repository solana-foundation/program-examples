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

// Instruction data layout, matching the program's
// `ReallocInstruction::ReallocateWithoutZeroInit(EnhancedAddressInfoExtender)` variant.
export const reallocateWithoutZeroInitEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['state', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['zip', getU32Encoder()],
]);

export function createReallocateWithoutZeroInitInstruction(
    target: Address,
    payer: TransactionSigner,
    programId: Address,
    state: string,
    zip: number,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: target, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: reallocateWithoutZeroInitEncoder.encode({
            instruction: ReallocInstruction.ReallocateWithoutZeroInit,
            state,
            zip,
        }),
    };
}

// Instruction data layout, matching the program's
// `ReallocInstruction::ReallocateZeroInit(WorkInfo)` variant.
export const reallocateZeroInitEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['position', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['company', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['years_employed', getU8Encoder()],
]);

export function createReallocateZeroInitInstruction(
    target: Address,
    _payer: Address,
    programId: Address,
    name: string,
    position: string,
    company: string,
    years_employed: number,
) {
    return {
        programAddress: programId,
        accounts: [{ address: target, role: AccountRole.WRITABLE }],
        data: reallocateZeroInitEncoder.encode({
            instruction: ReallocInstruction.ReallocateZeroInit,
            name,
            position,
            company,
            years_employed,
        }),
    };
}
