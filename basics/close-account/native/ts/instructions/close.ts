import { Buffer } from 'node:buffer';
import { type PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import * as borsh from 'borsh';
import { MyInstruction } from '.';

export class Close {
    instruction: MyInstruction;

    constructor(props: { instruction: MyInstruction }) {
        this.instruction = props.instruction;
    }

    toBuffer() {
        return Buffer.from(borsh.serialize(CloseSchema, this));
    }

    static fromBuffer(buffer: Buffer) {
        return borsh.deserialize(CloseSchema, Close, buffer);
    }
}

export const CloseSchema = new Map([
    [
        Close,
        {
            kind: 'struct',
            fields: [['instruction', 'u8']],
        },
    ],
]);

export function createCloseUserInstruction(
    target: PublicKey,
    payer: PublicKey,
    programId: PublicKey,
): TransactionInstruction {
    const instructionObject = new Close({
        instruction: MyInstruction.CloseUser,
    });

    const ix = new TransactionInstruction({
        keys: [
            { pubkey: target, isSigner: false, isWritable: true },
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: programId,
        data: instructionObject.toBuffer(),
    });

    return ix;
}
