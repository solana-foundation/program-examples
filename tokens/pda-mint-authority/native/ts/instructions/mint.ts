import { AccountRole, type Address, getStructEncoder, getU8Encoder, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { MyInstruction } from '.';
import { SYSVAR_RENT_ADDRESS, TOKEN_METADATA_PROGRAM_ADDRESS } from '../constants';

// Instruction data layout, matching the program's `MyInstruction::Mint` variant.
export const mintEncoder = getStructEncoder([['instruction', getU8Encoder()]]);

export function createMintInstruction(
    mint: Address,
    metadata: Address,
    edition: Address,
    mintAuthority: Address,
    mintConfig: Address,
    associatedTokenAccount: Address,
    payer: TransactionSigner,
    programId: Address,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: mint, role: AccountRole.WRITABLE },
            { address: metadata, role: AccountRole.WRITABLE },
            { address: edition, role: AccountRole.WRITABLE },
            { address: mintAuthority, role: AccountRole.WRITABLE },
            { address: mintConfig, role: AccountRole.READONLY },
            { address: associatedTokenAccount, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_METADATA_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: mintEncoder.encode({ instruction: MyInstruction.Mint }),
    };
}
