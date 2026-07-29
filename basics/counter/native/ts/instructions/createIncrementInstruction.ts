import { AccountRole, type Address } from '@solana/kit';
import { PROGRAM_ID } from '../';

export type IncrementInstructionAccounts = {
    counter: Address;
};

export function createIncrementInstruction(accounts: IncrementInstructionAccounts) {
    return {
        programAddress: PROGRAM_ID,
        accounts: [
            {
                address: accounts.counter,
                role: AccountRole.WRITABLE,
            },
        ],
        data: new Uint8Array([0x0]),
    };
}
