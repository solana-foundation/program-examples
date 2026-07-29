import { Buffer } from 'node:buffer';
import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
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

export function createCloseUserInstruction(target: Address, payer: TransactionSigner, programId: Address) {
    const instructionObject = new Close({
        instruction: MyInstruction.CloseUser,
    });

    return {
        programAddress: programId,
        accounts: [
            { address: target, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: new Uint8Array(instructionObject.toBuffer()),
    };
}
