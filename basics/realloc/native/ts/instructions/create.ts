import { Buffer } from 'node:buffer';
import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { ReallocInstruction } from './instruction';

const CreateSchema = {
    struct: {
        instruction: 'u8',
        name: 'string',
        house_number: 'u8',
        street: 'string',
        city: 'string',
    },
} as const;

export function createCreateInstruction(
    target: TransactionSigner,
    payer: TransactionSigner,
    programId: Address,
    name: string,
    house_number: number,
    street: string,
    city: string,
) {
    const data = Buffer.from(
        borsh.serialize(CreateSchema, {
            instruction: ReallocInstruction.Create,
            name,
            house_number,
            street,
            city,
        }),
    );

    return {
        programAddress: programId,
        accounts: [
            { address: target.address, role: AccountRole.WRITABLE_SIGNER, signer: target },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: new Uint8Array(data),
    };
}
