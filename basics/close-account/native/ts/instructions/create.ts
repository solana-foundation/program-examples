import { Buffer } from 'node:buffer';
import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { MyInstruction } from '.';

export class Create {
    instruction: MyInstruction;
    name: string;

    constructor(props: { instruction: MyInstruction; name: string }) {
        this.instruction = props.instruction;
        this.name = props.name;
    }

    toBuffer() {
        return Buffer.from(borsh.serialize(CreateSchema, this));
    }

    static fromBuffer(buffer: Buffer) {
        return borsh.deserialize(CreateSchema, Create, buffer);
    }
}

export const CreateSchema = new Map([
    [
        Create,
        {
            kind: 'struct',
            fields: [
                ['instruction', 'u8'],
                ['name', 'string'],
            ],
        },
    ],
]);

export function createCreateUserInstruction(
    target: Address,
    payer: TransactionSigner,
    programId: Address,
    name: string,
) {
    const instructionObject = new Create({
        instruction: MyInstruction.CreateUser,
        name,
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
