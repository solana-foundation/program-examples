import { AccountRole, type Address, getStructEncoder, getU8Encoder, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::Init` variant.
export const initEncoder = getStructEncoder([['instruction', getU8Encoder()]]);

export function createInitInstruction(mintAuthority: Address, payer: TransactionSigner, programId: Address) {
    return {
        programAddress: programId,
        accounts: [
            { address: mintAuthority, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: initEncoder.encode({ instruction: MyInstruction.Init }),
    };
}
