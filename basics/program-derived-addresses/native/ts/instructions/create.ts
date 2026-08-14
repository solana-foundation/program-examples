import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU32Encoder,
    getU8Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

// Instruction data layout, matching the program's `PageVisits` struct. The program
// tells its two instructions apart by which struct the data deserializes into.
export const createPageVisitsEncoder = getStructEncoder([
    ['pageVisits', getU32Encoder()],
    ['bump', getU8Encoder()],
]);

export function createCreatePageVisitsInstruction(
    pageVisitsAddress: Address,
    user: Address,
    payer: TransactionSigner,
    programId: Address,
    bump: number,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: pageVisitsAddress, role: AccountRole.WRITABLE },
            { address: user, role: AccountRole.READONLY },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        // A freshly created tracker starts with no visits recorded.
        data: createPageVisitsEncoder.encode({ pageVisits: 0, bump }),
    };
}
