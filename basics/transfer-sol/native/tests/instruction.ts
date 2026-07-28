import { Buffer } from 'node:buffer';
import { type PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
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
    payerPubkey: PublicKey,
    recipientPubkey: PublicKey,
    programId: PublicKey,
    instruction: InstructionType,
    amount: number,
): TransactionInstruction {
    const data = Buffer.from(
        borsh.serialize(TransferInstructionSchema, {
            instruction,
            amount,
        }),
    );

    return new TransactionInstruction({
        keys: [
            { pubkey: payerPubkey, isSigner: true, isWritable: true },
            { pubkey: recipientPubkey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId,
        data,
    });
}
