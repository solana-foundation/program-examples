import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU64Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::InitRentVault(InitRentVaultArgs)` variant.
export const initRentVaultEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['fundLamports', getU64Encoder()],
]);

export function createInitRentVaultInstruction(
    rentVault: Address,
    payer: TransactionSigner,
    programId: Address,
    fundLamports: bigint,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: rentVault, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: initRentVaultEncoder.encode({ instruction: MyInstruction.InitRentVault, fundLamports }),
    };
}
