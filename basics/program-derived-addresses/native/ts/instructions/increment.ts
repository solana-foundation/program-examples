import { AccountRole, type Address, getStructEncoder, type TransactionSigner } from '@solana/kit';

// Instruction data layout, matching the program's `IncrementPageVisits` struct,
// which has no fields and therefore encodes to zero bytes.
export const incrementPageVisitsEncoder = getStructEncoder([]);

export function createIncrementPageVisitsInstruction(
    pageVisitsAddress: Address,
    payer: TransactionSigner,
    programId: Address,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: pageVisitsAddress, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
        ],
        data: incrementPageVisitsEncoder.encode({}),
    };
}
