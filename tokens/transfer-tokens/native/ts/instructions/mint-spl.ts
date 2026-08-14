import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU64Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::MintSpl(MintSplArgs)` variant.
export const mintSplEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['quantity', getU64Encoder()],
]);

export function createMintSplInstruction(
    mint: Address,
    mintAuthority: Address,
    associatedTokenAccount: Address,
    payer: TransactionSigner,
    programId: Address,
    quantity: bigint,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: mint, role: AccountRole.WRITABLE },
            { address: mintAuthority, role: AccountRole.WRITABLE },
            { address: associatedTokenAccount, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: mintSplEncoder.encode({ instruction: MyInstruction.MintSpl, quantity }),
    };
}
