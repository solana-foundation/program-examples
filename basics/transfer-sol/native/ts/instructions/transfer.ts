import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU64Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { TransferInstruction } from '.';

// Instruction data layout, shared by the program's `TransferInstruction::CpiTransfer(u64)`
// and `TransferInstruction::ProgramTransfer(u64)` variants.
export const transferEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['amount', getU64Encoder()],
]);

// Moves lamports from the payer to the recipient by way of a System Program CPI.
export function createCpiTransferInstruction(
    payer: TransactionSigner,
    recipientAddress: Address,
    programId: Address,
    amount: bigint | number,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: recipientAddress, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: transferEncoder.encode({ instruction: TransferInstruction.CpiTransfer, amount }),
    };
}

// Moves lamports by directly editing the balances of two accounts the program owns.
export function createProgramTransferInstruction(
    payer: TransactionSigner,
    recipientAddress: Address,
    programId: Address,
    amount: bigint | number,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: recipientAddress, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: transferEncoder.encode({ instruction: TransferInstruction.ProgramTransfer, amount }),
    };
}
