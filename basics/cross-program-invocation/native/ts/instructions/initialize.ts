import { AccountRole, type Address, getBooleanEncoder, getStructEncoder, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

// Instruction data layout, matching the lever program's `PowerStatus` struct. The lever
// program tells its two instructions apart by which struct the data deserializes into.
export const initializeEncoder = getStructEncoder([['isOn', getBooleanEncoder()]]);

export function createInitializeInstruction(
    power: TransactionSigner,
    payer: TransactionSigner,
    leverProgramId: Address,
    isOn: boolean,
) {
    return {
        programAddress: leverProgramId,
        accounts: [
            { address: power.address, role: AccountRole.WRITABLE_SIGNER, signer: power },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: initializeEncoder.encode({ isOn }),
    };
}
