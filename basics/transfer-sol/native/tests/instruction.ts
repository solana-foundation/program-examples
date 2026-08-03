import { Buffer } from 'node:buffer';
import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';

export enum InstructionType {
    CpiTransfer = 0,
    ProgramTransfer = 1,
}

const TransferInstructionSchema = {
    struct: {
        instruction: 'u8',
        amount: 'u64',
    },
};

export function createTransferInstruction(
    payer: TransactionSigner,
    recipientAddress: Address,
    programId: Address,
    instruction: InstructionType,
    amount: number,
) {
    const data = Buffer.from(
        borsh.serialize(TransferInstructionSchema, {
            instruction,
            amount,
        }),
    );

    return {
        programAddress: programId,
        accounts: [
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: recipientAddress, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: new Uint8Array(data),
    };
}
