import { AccountRole, type Address, getStructEncoder, getU8Encoder, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::CreateNewAccount` variant.
export const createNewAccountEncoder = getStructEncoder([['instruction', getU8Encoder()]]);

export function createCreateNewAccountInstruction(
    newAccount: TransactionSigner,
    rentVault: Address,
    programId: Address,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: newAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: newAccount },
            { address: rentVault, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createNewAccountEncoder.encode({ instruction: MyInstruction.CreateNewAccount }),
    };
}
