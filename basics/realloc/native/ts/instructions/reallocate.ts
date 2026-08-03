import { Buffer } from 'node:buffer';
import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { ReallocInstruction } from './instruction';

const ReallocateWithoutZeroInitSchema = {
    struct: {
        instruction: 'u8',
        state: 'string',
        zip: 'u32',
    },
} as const;

export function createReallocateWithoutZeroInitInstruction(
    target: Address,
    payer: TransactionSigner,
    programId: Address,
    state: string,
    zip: number,
) {
    const data = Buffer.from(
        borsh.serialize(ReallocateWithoutZeroInitSchema, {
            instruction: ReallocInstruction.ReallocateWithoutZeroInit,
            state,
            zip,
        }),
    );

    return {
        programAddress: programId,
        accounts: [
            { address: target, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: new Uint8Array(data),
    };
}

const ReallocateZeroInitSchema = {
    struct: {
        instruction: 'u8',
        name: 'string',
        position: 'string',
        company: 'string',
        years_employed: 'u8',
    },
} as const;

export function createReallocateZeroInitInstruction(
    target: Address,
    _payer: Address,
    programId: Address,
    name: string,
    position: string,
    company: string,
    years_employed: number,
) {
    const data = Buffer.from(
        borsh.serialize(ReallocateZeroInitSchema, {
            instruction: ReallocInstruction.ReallocateZeroInit,
            name,
            position,
            company,
            years_employed,
        }),
    );

    return {
        programAddress: programId,
        accounts: [{ address: target, role: AccountRole.WRITABLE }],
        data: new Uint8Array(data),
    };
}
